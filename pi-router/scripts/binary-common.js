import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseArtifactMarker, VERSION } from "../src/version.js";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = resolve(packageRoot, "..");
export const binaryPath = resolve(packageRoot, "bin/pi-router-android-aarch64");
export const checksumPath = `${binaryPath}.sha256`;
export const provenancePath = resolve(repositoryRoot, "docs/provenance/pi-router-termux-build.json");

export const TERMUX_NODE = Object.freeze({
	package: "nodejs",
	version: "26.4.0",
	architecture: "aarch64",
	url: "https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/nodejs_26.4.0_aarch64.deb",
	sha256: "f2b8530d6d7ae72ee560d2791686f1849df9644396d56da915b31cd42c50a62d",
	path: "data/data/com.termux/files/usr/bin/node",
});

export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
export const ARTIFACT_MARKER = releaseArtifactMarker(VERSION);
export const BIONIC_MAIN_IMAGE_PATCH = "dl-iterate-phdr-v1";

const SEA_CALLBACK_SIGNATURE = Buffer.from(
	"5f2403d5e80300aa20008052010141ad020d40ad410001ad420c00adc0035fd6",
	"hex",
);
const SEA_CALLBACK_TAIL = SEA_CALLBACK_SIGNATURE.subarray(8);
const SEA_CALLBACK_STUB_OFFSET = 0x400;
const SEA_CALLBACK_STUB = Object.freeze([
	0xf9400408, // ldr x8, [x0, #8] — dlpi_name
	0x39400509, // ldrb w9, [x8, #1]
	0x7101913f, // cmp w9, #0x64 — "/data/..."
	0x540000e1, // b.ne skip
	0xad410001, // ldp q1, q0, [x0, #0x20]
	0xad400c02, // ldp q2, q3, [x0]
	0xad010041, // stp q1, q0, [x2, #0x20]
	0xad000c42, // stp q2, q3, [x2]
	0x52800020, // mov w0, #1
	0xd65f03c0, // ret
	0x52800000, // skip: mov w0, #0
	0xd65f03c0, // ret
]);

function callbackCandidates(binary) {
	const matches = [];
	for (let at = binary.indexOf(SEA_CALLBACK_TAIL); at !== -1;) {
		const callbackAt = at - 8;
		if (
			callbackAt >= 0
			&& binary.readUInt32LE(callbackAt) === SEA_CALLBACK_SIGNATURE.readUInt32LE(0)
		) {
			matches.push(callbackAt);
		}
		at = binary.indexOf(SEA_CALLBACK_TAIL, at + 1);
	}
	return matches;
}

function callbackBranch(callbackAt) {
	const branchAt = callbackAt + 4;
	const delta = SEA_CALLBACK_STUB_OFFSET - branchAt;
	if (delta % 4 !== 0 || delta < -(2 ** 27) || delta >= 2 ** 27) {
		throw new Error("Termux SEA callback patch branch is out of range.");
	}
	return 0x14000000 | ((delta >> 2) & 0x03ff_ffff);
}

function stubBytes() {
	const bytes = Buffer.alloc(SEA_CALLBACK_STUB.length * 4);
	SEA_CALLBACK_STUB.forEach((word, index) => {
		bytes.writeUInt32LE(word, index * 4);
	});
	return bytes;
}

export function patchBionicSeaCallback(binary) {
	const originalAt = binary.indexOf(SEA_CALLBACK_SIGNATURE);
	if (originalAt === -1 || originalAt !== binary.lastIndexOf(SEA_CALLBACK_SIGNATURE)) {
		throw new Error("Pinned Termux Node SEA callback signature is missing or ambiguous.");
	}
	const stub = stubBytes();
	if (
		!binary
			.subarray(SEA_CALLBACK_STUB_OFFSET, SEA_CALLBACK_STUB_OFFSET + stub.length)
			.every((byte) => byte === 0)
	) {
		throw new Error("Pinned Termux Node executable patch area is occupied.");
	}
	stub.copy(binary, SEA_CALLBACK_STUB_OFFSET);
	binary.writeUInt32LE(callbackBranch(originalAt), originalAt + 4);
	validateBionicSeaCallbackPatch(binary);
	return binary;
}

export function validateBionicSeaCallbackPatch(binary) {
	const candidates = callbackCandidates(binary);
	if (candidates.length !== 1) {
		throw new Error("Termux SEA callback patch location is missing or ambiguous.");
	}
	const callbackAt = candidates[0];
	if (binary.readUInt32LE(callbackAt + 4) !== callbackBranch(callbackAt)) {
		throw new Error("Termux SEA callback does not branch to the Bionic image selector.");
	}
	const stub = stubBytes();
	if (!binary.subarray(SEA_CALLBACK_STUB_OFFSET, SEA_CALLBACK_STUB_OFFSET + stub.length).equals(stub)) {
		throw new Error("Termux SEA Bionic image selector is missing or corrupt.");
	}
}

async function filesBelow(directory, suffix) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await filesBelow(path, suffix));
		} else if (entry.isFile() && path.endsWith(suffix)) {
			files.push(path);
		}
	}
	return files;
}

export async function binaryInputDigest() {
	const paths = [
		...await filesBelow(resolve(packageRoot, "src"), ".js"),
		resolve(packageRoot, "web/dist/index.html"),
		resolve(packageRoot, "package.json"),
		resolve(packageRoot, "package-lock.json"),
		resolve(packageRoot, "scripts/build-binary.js"),
		resolve(packageRoot, "scripts/binary-common.js"),
	].sort();
	const hash = createHash("sha256");
	for (const path of paths) {
		hash.update(relative(packageRoot, path));
		hash.update("\0");
		hash.update(await readFile(path));
		hash.update("\0");
	}
	return hash.digest("hex");
}
