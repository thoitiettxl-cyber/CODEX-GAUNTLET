import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VERSION } from "../src/version.js";
import { binaryPath } from "./binary-common.js";

function binaryEnvironment(extra = {}) {
	const libraryPath = process.env.PI_ROUTER_BINARY_LIBRARY_PATH;
	return {
		...process.env,
		NODE_OPTIONS: "",
		PI_OFFLINE: "1",
		...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
		...extra,
	};
}

function command(args, options = {}) {
	const result = spawnSync(binaryPath, args, {
		encoding: "utf8",
		env: binaryEnvironment(),
		...options,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`Binary command failed: ${args.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
		);
	}
	return result.stdout;
}

const uname = spawnSync("uname", ["-o"], { encoding: "utf8" });
const machine = spawnSync("uname", ["-m"], { encoding: "utf8" });
if (uname.stdout.trim() !== "Android" || machine.stdout.trim() !== "aarch64") {
	process.stdout.write("SKIP: native Pi Router binary execution requires Android aarch64.\n");
	process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "pi-router-binary-smoke-"));
let child;
try {
	if (command(["--version"]).trim() !== `pi-router ${VERSION}`) {
		throw new Error("Binary version output is unexpected.");
	}
	if (!command(["help"]).includes("Pi Router Management Center")) {
		throw new Error("Binary help does not describe the Management Center.");
	}
	command(["models", "--state-dir", root]);

	child = spawn(binaryPath, ["serve", "--host", "127.0.0.1", "--port", "0", "--state-dir", root], {
		env: binaryEnvironment({
			PI_ROUTER_API_KEY: "binary-smoke-proxy-key",
			PI_ROUTER_MANAGEMENT_KEY: "binary-smoke-management-key",
		}),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	let baseUrl = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		output += chunk;
		const match = /pi-router listening on (http:\/\/[^\s]+)/u.exec(output);
		if (match) {
			baseUrl = match[1];
		}
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});

	const deadline = Date.now() + 15_000;
	while (!baseUrl && child.exitCode === null && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	if (!baseUrl) {
		throw new Error(`Binary server did not start.\n${output}`);
	}
	const health = await fetch(`${baseUrl}/health`);
	if (!health.ok || (await health.json()).version !== VERSION) {
		throw new Error("Binary health smoke failed.");
	}
	const html = await (await fetch(`${baseUrl}/management.html`)).text();
	if (
		!html.includes("<title>Pi Router · Management Center</title>")
		|| !html.includes("data-pi-router-ui")
		|| !html.includes("Quota Management")
		|| !html.includes("Config Panel")
	) {
		throw new Error("Binary Management Center smoke failed.");
	}
	const management = await fetch(`${baseUrl}/management/api/status`, {
		headers: { authorization: "Bearer binary-smoke-management-key" },
	});
	if (!management.ok || (await management.json()).runtime?.mode !== "termux-binary") {
		throw new Error("Binary Management API smoke failed.");
	}
	const providers = await fetch(`${baseUrl}/management/api/providers`, {
		headers: { authorization: "Bearer binary-smoke-management-key" },
	});
	if (!providers.ok || !Array.isArray((await providers.json()).data)) {
		throw new Error("Binary provider inventory smoke failed.");
	}
	const models = await fetch(`${baseUrl}/v1/models`, {
		headers: { authorization: "Bearer binary-smoke-proxy-key" },
	});
	if (!models.ok || !Array.isArray((await models.json()).data)) {
		throw new Error("Binary proxy-key model inventory smoke failed.");
	}
	process.stdout.write("PASS: native Pi Router Android AArch64 binary smoke.\n");
} finally {
	if (child?.exitCode === null) {
		const exited = once(child, "exit");
		child.kill("SIGTERM");
		await exited;
	}
	await rm(root, { recursive: true, force: true });
}
