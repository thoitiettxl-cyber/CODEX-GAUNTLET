import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { validateAndroidElf } from "../src/update.js";
import { VERSION } from "../src/version.js";
import {
	ARTIFACT_MARKER,
	BIONIC_MAIN_IMAGE_PATCH,
	TERMUX_NODE,
	binaryInputDigest,
	binaryPath,
	checksumPath,
	packageRoot,
	provenancePath,
	validateBionicSeaCallbackPatch,
} from "./binary-common.js";

await access(binaryPath);
const [binary, checksumText, provenanceText, packageText] = await Promise.all([
	readFile(binaryPath),
	readFile(checksumPath, "utf8"),
	readFile(provenancePath, "utf8"),
	readFile(resolve(packageRoot, "package.json"), "utf8"),
]);
const provenance = JSON.parse(provenanceText);
const packageJson = JSON.parse(packageText);
const sha256 = createHash("sha256").update(binary).digest("hex");
const expectedChecksum = `${sha256}  ${basename(binaryPath)}\n`;
const identity = validateAndroidElf(binary);
validateBionicSeaCallbackPatch(binary);
const fileStat = await stat(binaryPath);
const inputSha256 = await binaryInputDigest();

if (packageJson.version !== VERSION || provenance.source?.router_version !== VERSION) {
	throw new Error("Pi Router package, source, and binary provenance versions differ.");
}
if (
	provenance.base?.version !== TERMUX_NODE.version
	|| provenance.base?.deb_sha256 !== TERMUX_NODE.sha256
	|| provenance.build?.host !== "android-aarch64"
	|| provenance.build?.sea_preparation !== "pinned-termux-node-elf"
	|| provenance.build?.bionic_main_image_patch !== BIONIC_MAIN_IMAGE_PATCH
) {
	throw new Error("Pi Router binary provenance does not match its pinned Termux build.");
}
if (provenance.source?.input_sha256 !== inputSha256) {
	throw new Error("Pi Router binary is stale; run npm --prefix pi-router run build:binary.");
}
if (
	provenance.artifact?.sha256 !== sha256
	|| provenance.artifact?.size !== binary.length
	|| checksumText !== expectedChecksum
) {
	throw new Error("Pi Router binary checksum or size does not match committed provenance.");
}
if ((fileStat.mode & 0o777) !== 0o755 || !binary.includes(Buffer.from(ARTIFACT_MARKER))) {
	throw new Error("Pi Router binary mode or embedded source marker is invalid.");
}
if (
	provenance.artifact?.format !== identity.format
	|| provenance.artifact?.machine !== identity.machine
	|| provenance.artifact?.interpreter !== identity.interpreter
) {
	throw new Error("Pi Router binary ELF identity does not match committed provenance.");
}

process.stdout.write(
	`Checked ${binaryPath}: ${identity.format} ${identity.machine} ${identity.interpreter} ${sha256}\n`,
);
