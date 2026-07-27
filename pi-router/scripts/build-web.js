import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "web/dist/index.html");
const buildDirectory = await mkdtemp(resolve(packageRoot, ".web-build-"));

try {
	await build({
		configFile: resolve(packageRoot, "vite.config.ts"),
		logLevel: "warn",
		build: {
			outDir: buildDirectory,
			emptyOutDir: true,
		},
	});
	const html = await readFile(resolve(buildDirectory, "index.html"), "utf8");
	const artifacts = await readdir(buildDirectory);
	if (
		artifacts.length !== 1
		|| artifacts[0] !== "index.html"
		|| /<script[^>]+\ssrc=/iu.test(html)
		|| /<link[^>]+\shref=/iu.test(html)
		|| (html.match(/__PI_ROUTER_CSP_NONCE__/gu)?.length ?? 0) !== 1
	) {
		throw new Error("Vite did not produce the expected self-contained Management HTML.");
	}

	if (process.argv.includes("--check")) {
		let current;
		try {
			current = await readFile(outputPath, "utf8");
		} catch {
			throw new Error(
				"Management HTML is missing. Run npm --prefix pi-router run build:web.",
			);
		}
		if (current !== html) {
			throw new Error(
				"Management HTML is stale. Run npm --prefix pi-router run build:web.",
			);
		}
		process.stdout.write(`Checked ${outputPath}\n`);
	} else {
		await mkdir(dirname(outputPath), { recursive: true });
		const temporaryPath = `${outputPath}.tmp`;
		await writeFile(temporaryPath, html, { encoding: "utf8", mode: 0o644 });
		await rename(temporaryPath, outputPath);
		process.stdout.write(`Built ${outputPath}\n`);
	}
} finally {
	await rm(buildDirectory, { recursive: true, force: true });
}
