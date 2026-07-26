import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { build } from "esbuild";
import postject from "postject";

import { validateAndroidElf } from "../src/update.js";
import { VERSION } from "../src/version.js";
import {
	ARTIFACT_MARKER,
	BIONIC_MAIN_IMAGE_PATCH,
	SEA_FUSE,
	TERMUX_NODE,
	binaryInputDigest,
	binaryPath,
	checksumPath,
	packageRoot,
	patchBionicSeaCallback,
	provenancePath,
} from "./binary-common.js";

const MAX_NODE_PACKAGE_BYTES = 24 * 1024 * 1024;

function fail(message) {
	throw new Error(`Termux binary build: ${message}`);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: packageRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
	if (result.error || result.status !== 0) {
		const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		fail(`${basename(command)} failed${detail ? `: ${detail}` : ""}`);
	}
	return result.stdout.trim();
}

const seaPreparationLibraryPath = process.env.PI_ROUTER_SEA_PREP_LIBRARY_PATH;

function runSeaNode(nodePath, args) {
	return run(nodePath, args, {
		env: {
			...process.env,
			NODE_OPTIONS: "",
			...(seaPreparationLibraryPath
				? { LD_LIBRARY_PATH: seaPreparationLibraryPath }
				: {}),
		},
	});
}

async function downloadPinnedNode(path) {
	const localPackage = process.env.PI_ROUTER_TERMUX_NODE_DEB;
	if (localPackage) {
		await copyFile(resolve(localPackage), path);
	} else {
		const response = await fetch(TERMUX_NODE.url, {
			redirect: "follow",
			signal: AbortSignal.timeout(60_000),
			headers: { "user-agent": `pi-router-binary-builder/${VERSION}` },
		});
		if (!response.ok || !response.body) {
			fail(`Termux Node package returned HTTP ${response.status}`);
		}
		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > MAX_NODE_PACKAGE_BYTES) {
			fail("Termux Node package exceeded its size limit");
		}
		const reader = response.body.getReader();
		const chunks = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > MAX_NODE_PACKAGE_BYTES) {
				await reader.cancel();
				fail("Termux Node package exceeded its size limit");
			}
			chunks.push(Buffer.from(value));
		}
		await writeFile(path, Buffer.concat(chunks, size), { mode: 0o600 });
	}
	const bytes = await readFile(path);
	const checksum = createHash("sha256").update(bytes).digest("hex");
	if (checksum !== TERMUX_NODE.sha256) {
		fail(`Termux Node package checksum mismatch: ${checksum}`);
	}
}

if (run("uname", ["-o"]) !== "Android" || run("uname", ["-m"]) !== "aarch64") {
	fail("the SEA blob must be prepared natively on Android aarch64");
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "pi-router-binary-"));
try {
	const packagePath = resolve(temporaryRoot, "nodejs.deb");
	const extractedRoot = resolve(temporaryRoot, "termux-node");
	const bundlePath = resolve(temporaryRoot, "pi-router.cjs");
	const configPath = resolve(temporaryRoot, "sea-config.json");
	const blobPath = resolve(temporaryRoot, "pi-router.blob");
	const candidatePath = resolve(temporaryRoot, "pi-router-android-aarch64");

	await downloadPinnedNode(packagePath);
	await mkdir(extractedRoot, { recursive: true });
	run("dpkg-deb", ["-x", packagePath, extractedRoot]);
	const baseNodePath = resolve(extractedRoot, TERMUX_NODE.path);
	const baseNode = await readFile(baseNodePath);
	validateAndroidElf(baseNode);
	const seaPreparationNode = resolve(
		process.env.PI_ROUTER_SEA_PREP_NODE || baseNodePath,
	);
	const seaPreparationNodeBytes = await readFile(seaPreparationNode);
	if (!seaPreparationNodeBytes.equals(baseNode)) {
		fail("the SEA preparation executable must exactly match the pinned Termux Node base");
	}
	const seaPreparationVersion = runSeaNode(
		seaPreparationNode,
		["--version"],
	).replace(/^v/u, "");
	if (seaPreparationVersion !== TERMUX_NODE.version) {
		fail(
			`prepare the SEA with Node ${TERMUX_NODE.version}; found ${seaPreparationVersion}`,
		);
	}

	const managementHtml = await readFile(resolve(packageRoot, "web/dist/index.html"), "utf8");
	await build({
		entryPoints: [resolve(packageRoot, "src/cli.js")],
		bundle: true,
		define: {
			__PI_ROUTER_BINARY_BUILD__: "true",
			__PI_ROUTER_MANAGEMENT_HTML__: JSON.stringify(managementHtml),
			"import.meta.url": JSON.stringify(
				"file:///data/data/com.termux/files/usr/lib/pi-router/embedded.cjs",
			),
		},
		footer: {
			js: `\n;void ${JSON.stringify(ARTIFACT_MARKER)};`,
		},
		format: "cjs",
		legalComments: "inline",
		minify: true,
		outfile: bundlePath,
		platform: "node",
		target: [`node${TERMUX_NODE.version}`],
	});

	await writeFile(configPath, `${JSON.stringify({
		main: bundlePath,
		output: blobPath,
		disableExperimentalSEAWarning: true,
		useCodeCache: false,
		useSnapshot: false,
	}, null, 2)}\n`);
	runSeaNode(seaPreparationNode, ["--experimental-sea-config", configPath]);
	await copyFile(baseNodePath, candidatePath);
	await chmod(candidatePath, 0o755);
	await postject.inject(
		candidatePath,
		"NODE_SEA_BLOB",
		await readFile(blobPath),
		{ sentinelFuse: SEA_FUSE },
	);
	await writeFile(
		candidatePath,
		patchBionicSeaCallback(await readFile(candidatePath)),
	);

	const candidate = await readFile(candidatePath);
	const identity = validateAndroidElf(candidate);
	if (!candidate.includes(Buffer.from(ARTIFACT_MARKER))) {
		fail("the SEA artifact is missing its source marker");
	}
	const sha256 = createHash("sha256").update(candidate).digest("hex");
	const inputSha256 = await binaryInputDigest();
	const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
	const postjectPackage = JSON.parse(
		await readFile(resolve(packageRoot, "node_modules/postject/package.json"), "utf8"),
	);

	await mkdir(dirname(binaryPath), { recursive: true });
	await rename(candidatePath, binaryPath);
	await chmod(binaryPath, 0o755);
	await writeFile(
		checksumPath,
		`${sha256}  ${basename(binaryPath)}\n`,
		{ encoding: "utf8", mode: 0o644 },
	);
	await mkdir(dirname(provenancePath), { recursive: true });
	await writeFile(
		provenancePath,
		`${JSON.stringify({
			schema_version: 1,
			source: {
				router_version: packageJson.version,
				input_sha256: inputSha256,
			},
			base: {
				kind: "termux-package",
				package: TERMUX_NODE.package,
				version: TERMUX_NODE.version,
				architecture: TERMUX_NODE.architecture,
				url: TERMUX_NODE.url,
				deb_sha256: TERMUX_NODE.sha256,
			},
			build: {
				format: "node-sea",
				host: "android-aarch64",
				node: seaPreparationVersion,
				sea_preparation: "pinned-termux-node-elf",
				postject: postjectPackage.version,
				bionic_main_image_patch: BIONIC_MAIN_IMAGE_PATCH,
				code_cache: false,
				snapshot: false,
			},
			artifact: {
				path: "pi-router/bin/pi-router-android-aarch64",
				sha256,
				size: candidate.length,
				mode: "0755",
				...identity,
				android_api: 24,
			},
		}, null, 2)}\n`,
		{ encoding: "utf8", mode: 0o644 },
	);
	process.stdout.write(`Built ${binaryPath}\nSHA-256 ${sha256}\n`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
