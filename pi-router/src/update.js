import { createHash, randomUUID } from "node:crypto";
import {
	constants as fsConstants,
	copyFile,
	lstat,
	open,
	readFile,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { RouterError, invalidRequest } from "./errors.js";
import {
	BINARY_BUILD,
	RELEASE_ASSET,
	RELEASE_CHECKSUM_ASSET,
	RELEASE_REPOSITORY,
	RELEASE_TAG_PREFIX,
	VERSION,
	releaseArtifactMarker,
} from "./version.js";

const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;
const MAX_CHECKSUM_BYTES = 16 * 1024;
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const GITHUB_API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ELF_PROGRAM_HEADER_BYTES = 56;
const ELF_PT_INTERP = 3;
const ANDROID_INTERPRETER = "/system/bin/linker64";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function updateError(message, code, status = 502) {
	return new RouterError(message, {
		status,
		code,
		type: "update_error",
	});
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVersion(value) {
	if (typeof value !== "string") {
		return null;
	}
	const match = VERSION_PATTERN.exec(value);
	if (!match) {
		return null;
	}
	const parts = match.slice(1).map(Number);
	if (!parts.every(Number.isSafeInteger)) {
		return null;
	}
	return parts;
}

export function compareVersions(left, right) {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	if (!leftParts || !rightParts) {
		throw new TypeError("compareVersions requires strict MAJOR.MINOR.PATCH values");
	}
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] < rightParts[index] ? -1 : 1;
		}
	}
	return 0;
}

function requireHttps(value, label, allowInsecure) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw updateError(`GitHub returned an invalid ${label}.`, "update_release_invalid");
	}
	if (url.protocol !== "https:" && !allowInsecure) {
		throw updateError(`GitHub returned a non-HTTPS ${label}.`, "update_release_invalid");
	}
	if (url.username || url.password) {
		throw updateError(`GitHub returned a credential-bearing ${label}.`, "update_release_invalid");
	}
	return url.href;
}

function releaseVersion(release) {
	if (!isRecord(release) || typeof release.tag_name !== "string") {
		return null;
	}
	if (!release.tag_name.startsWith(RELEASE_TAG_PREFIX)) {
		return null;
	}
	const version = release.tag_name.slice(RELEASE_TAG_PREFIX.length);
	return parseVersion(version) ? version : null;
}

function releaseAsset(release, name) {
	if (!Array.isArray(release.assets)) {
		return null;
	}
	const matches = release.assets.filter((asset) => (
		isRecord(asset)
		&& asset.name === name
		&& (asset.state === undefined || asset.state === "uploaded")
	));
	return matches.length === 1 ? matches[0] : null;
}

export function selectRelease(releases, { allowInsecure = false } = {}) {
	if (!Array.isArray(releases)) {
		throw updateError("GitHub release metadata was not an array.", "update_release_invalid");
	}
	const eligible = releases
		.filter((release) => (
			isRecord(release)
			&& release.draft === false
			&& release.prerelease === false
			&& typeof release.published_at === "string"
			&& releaseVersion(release)
		))
		.sort((left, right) => compareVersions(releaseVersion(right), releaseVersion(left)));
	const release = eligible[0];
	if (!release) {
		throw updateError("No stable Pi Router release is available.", "update_release_not_found", 404);
	}

	const version = releaseVersion(release);
	const asset = releaseAsset(release, RELEASE_ASSET);
	const checksumAsset = releaseAsset(release, RELEASE_CHECKSUM_ASSET);
	if (!asset || !checksumAsset) {
		throw updateError("The latest Pi Router release is missing required assets.", "update_assets_missing");
	}
	if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BINARY_BYTES) {
		throw updateError("The Pi Router release binary has an invalid size.", "update_asset_size");
	}
	if (
		!Number.isSafeInteger(checksumAsset.size)
		|| checksumAsset.size <= 0
		|| checksumAsset.size > MAX_CHECKSUM_BYTES
	) {
		throw updateError("The Pi Router checksum asset has an invalid size.", "update_checksum_size");
	}

	let digest = null;
	if (asset.digest !== undefined && asset.digest !== null) {
		if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)) {
			throw updateError("The Pi Router release digest is invalid.", "update_release_invalid");
		}
		digest = asset.digest.slice("sha256:".length);
	}

	return {
		version,
		tag: `${RELEASE_TAG_PREFIX}${version}`,
		publishedAt: typeof release.published_at === "string" ? release.published_at : null,
		releaseUrl: requireHttps(release.html_url, "release URL", allowInsecure),
		asset: {
			name: RELEASE_ASSET,
			size: asset.size,
			url: requireHttps(asset.browser_download_url, "binary URL", allowInsecure),
			digest,
		},
		checksum: {
			name: RELEASE_CHECKSUM_ASSET,
			size: checksumAsset.size,
			url: requireHttps(checksumAsset.browser_download_url, "checksum URL", allowInsecure),
		},
	};
}

export function parseChecksum(text, assetName = RELEASE_ASSET) {
	if (typeof text !== "string") {
		throw updateError("The release checksum is not text.", "update_checksum_invalid");
	}
	const matches = [];
	for (const line of text.split(/\r?\n/u)) {
		const match = /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/u.exec(line.trim());
		if (match && match[2] === assetName) {
			matches.push(match[1].toLowerCase());
		}
	}
	if (matches.length !== 1) {
		throw updateError("The release checksum does not identify the Pi Router binary.", "update_checksum_invalid");
	}
	return matches[0];
}

function elfInterpreter(buffer) {
	const programOffset = buffer.readBigUInt64LE(32);
	const entrySize = buffer.readUInt16LE(54);
	const entryCount = buffer.readUInt16LE(56);
	if (
		entrySize < ELF_PROGRAM_HEADER_BYTES
		|| entryCount < 1
		|| entryCount > 4096
	) {
		return null;
	}
	const tableEnd = programOffset + (BigInt(entrySize) * BigInt(entryCount));
	if (programOffset > BigInt(buffer.length) || tableEnd > BigInt(buffer.length)) {
		return null;
	}

	let interpreter = null;
	const firstEntry = Number(programOffset);
	for (let index = 0; index < entryCount; index += 1) {
		const entry = firstEntry + (index * entrySize);
		if (buffer.readUInt32LE(entry) !== ELF_PT_INTERP) {
			continue;
		}
		if (interpreter !== null) {
			return null;
		}
		const segmentOffset = buffer.readBigUInt64LE(entry + 8);
		const segmentSize = buffer.readBigUInt64LE(entry + 32);
		const segmentEnd = segmentOffset + segmentSize;
		if (
			segmentSize < 2n
			|| segmentSize > 4096n
			|| segmentOffset > BigInt(buffer.length)
			|| segmentEnd > BigInt(buffer.length)
		) {
			return null;
		}
		const bytes = buffer.subarray(Number(segmentOffset), Number(segmentEnd));
		if (bytes.at(-1) !== 0 || bytes.subarray(0, -1).includes(0)) {
			return null;
		}
		interpreter = bytes.subarray(0, -1).toString("utf8");
	}
	return interpreter;
}

export function validateAndroidElf(bytes, { expectedVersion } = {}) {
	const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	if (
		buffer.length < 64
		|| buffer[0] !== 0x7f
		|| buffer[1] !== 0x45
		|| buffer[2] !== 0x4c
		|| buffer[3] !== 0x46
		|| buffer[4] !== 2
		|| buffer[5] !== 1
	) {
		throw updateError("The release asset is not an ELF64 little-endian binary.", "update_binary_identity");
	}
	if (buffer.readUInt16LE(18) !== 183) {
		throw updateError("The release asset is not an AArch64 binary.", "update_binary_identity");
	}
	if (elfInterpreter(buffer) !== ANDROID_INTERPRETER) {
		throw updateError("The release asset does not use Android's linker.", "update_binary_identity");
	}
	if (
		expectedVersion !== undefined
		&& (
			!parseVersion(expectedVersion)
			|| !buffer.includes(Buffer.from(releaseArtifactMarker(expectedVersion), "utf8"))
		)
	) {
		throw updateError(
			"The release asset does not contain the expected Pi Router version.",
			"update_binary_version",
		);
	}
	return {
		format: "ELF64",
		machine: "AArch64",
		interpreter: ANDROID_INTERPRETER,
	};
}

async function boundedBody(response, maximum, label) {
	const declared = Number(response.headers?.get?.("content-length"));
	if (Number.isFinite(declared) && declared > maximum) {
		throw updateError(`${label} exceeded its size limit.`, "update_response_too_large");
	}
	if (!response.body) {
		throw updateError(`${label} returned no response body.`, "update_network_error");
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
		if (size > maximum) {
			await reader.cancel();
			throw updateError(`${label} exceeded its size limit.`, "update_response_too_large");
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks, size);
}

async function ownedRegularFile(path, label) {
	let stat;
	try {
		stat = await lstat(path);
	} catch {
		throw updateError(`${label} is unavailable.`, "update_target_unavailable", 409);
	}
	if (!stat.isFile()) {
		throw updateError(`${label} must be a regular file, not a symlink.`, "update_target_unsafe", 409);
	}
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		throw updateError(`${label} is not owned by the current user.`, "update_target_unsafe", 409);
	}
	return stat;
}

async function syncDirectory(path) {
	let handle;
	try {
		handle = await open(path, fsConstants.O_RDONLY);
		await handle.sync();
	} catch (error) {
		if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) {
			throw error;
		}
	} finally {
		await handle?.close();
	}
}

async function writeSynced(path, bytes, mode) {
	const handle = await open(path, "wx", mode);
	try {
		await handle.writeFile(bytes);
		await handle.chmod(mode);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function publicCandidate(candidate, currentVersion) {
	return {
		status: compareVersions(candidate.version, currentVersion) > 0 ? "available" : "current",
		current_version: currentVersion,
		latest_version: candidate.version,
		published_at: candidate.publishedAt,
		release_url: candidate.releaseUrl,
		asset: {
			name: candidate.asset.name,
			size: candidate.asset.size,
		},
	};
}

export class GithubUpdateManager {
	constructor({
		currentVersion = VERSION,
		repository = RELEASE_REPOSITORY,
		apiBase = "https://api.github.com",
		fetchImpl = globalThis.fetch,
		binaryPath = BINARY_BUILD ? process.execPath : null,
		automatic = false,
		allowInsecureForTests = false,
	} = {}) {
		if (!parseVersion(currentVersion)) {
			throw new TypeError("currentVersion must be MAJOR.MINOR.PATCH");
		}
		if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
			throw new TypeError("repository must be owner/name");
		}
		if (typeof fetchImpl !== "function") {
			throw new TypeError("fetchImpl must be a function");
		}
		if (binaryPath !== null && (!isAbsolute(binaryPath) || binaryPath.endsWith("/"))) {
			throw new TypeError("binaryPath must be an absolute file path or null");
		}
		this.currentVersion = currentVersion;
		this.repository = repository;
		this.apiBase = requireHttps(apiBase, "API URL", allowInsecureForTests).replace(/\/$/u, "");
		this.fetchImpl = fetchImpl;
		this.binaryPath = binaryPath;
		this.automatic = Boolean(automatic);
		this.allowInsecureForTests = allowInsecureForTests;
		this.mutating = false;
		this.pendingVersion = null;
	}

	async #fetch(url, maximum, label, accept) {
		let currentUrl = requireHttps(url, `${label} URL`, this.allowInsecureForTests);
		for (let redirectCount = 0; ; redirectCount += 1) {
			let response;
			try {
				response = await this.fetchImpl(currentUrl, {
					cache: "no-store",
					redirect: "manual",
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					headers: {
						accept,
						"user-agent": `pi-router/${this.currentVersion}`,
						"x-github-api-version": GITHUB_API_VERSION,
					},
				});
			} catch {
				throw updateError(`${label} could not be downloaded.`, "update_network_error");
			}
			if (REDIRECT_STATUSES.has(response?.status)) {
				if (redirectCount >= MAX_REDIRECTS) {
					throw updateError(`${label} returned too many redirects.`, "update_network_error");
				}
				const location = response.headers?.get?.("location");
				if (!location) {
					throw updateError(`${label} returned an invalid redirect.`, "update_network_error");
				}
				let redirected;
				try {
					redirected = new URL(location, currentUrl).href;
				} catch {
					throw updateError(`${label} returned an invalid redirect.`, "update_network_error");
				}
				currentUrl = requireHttps(
					redirected,
					`${label} redirect`,
					this.allowInsecureForTests,
				);
				try {
					await response.body?.cancel();
				} catch {
					// The redirect target has already been validated; body cleanup is best effort.
				}
				continue;
			}
			if (!response?.ok) {
				throw updateError(`${label} returned HTTP ${response?.status ?? "unknown"}.`, "update_network_error");
			}
			if (response.url) {
				requireHttps(response.url, `${label} response URL`, this.allowInsecureForTests);
			}
			return boundedBody(response, maximum, label);
		}
	}

	async #discover() {
		const metadata = await this.#fetch(
			`${this.apiBase}/repos/${this.repository}/releases?per_page=30`,
			MAX_RELEASE_METADATA_BYTES,
			"GitHub release metadata",
			"application/vnd.github+json",
		);
		let releases;
		try {
			releases = JSON.parse(metadata.toString("utf8"));
		} catch {
			throw updateError("GitHub release metadata was not valid JSON.", "update_release_invalid");
		}
		return selectRelease(releases, { allowInsecure: this.allowInsecureForTests });
	}

	async status() {
		let rollbackAvailable = false;
		if (this.binaryPath) {
			try {
				const previous = await lstat(`${this.binaryPath}.previous`);
				rollbackAvailable = previous.isFile();
			} catch {
				rollbackAvailable = false;
			}
		}
		return {
			repository: this.repository,
			channel: "stable",
			automatic: this.automatic,
			install_supported: this.binaryPath !== null,
			rollback_available: rollbackAvailable,
			restart_required: this.pendingVersion !== null,
			pending_version: this.pendingVersion,
		};
	}

	async check() {
		const candidate = await this.#discover();
		return publicCandidate(candidate, this.currentVersion);
	}

	async #replace(bytes) {
		const target = this.binaryPath;
		if (!target) {
			throw updateError(
				"Binary installation is unavailable in source mode.",
				"update_install_unsupported",
				409,
			);
		}
		await ownedRegularFile(target, "The installed Pi Router binary");
		const directory = dirname(target);
		const nonce = `${process.pid}-${randomUUID()}`;
		const candidatePath = `${target}.update-${nonce}`;
		const backupPath = `${target}.previous`;
		const backupTemporaryPath = `${backupPath}.update-${nonce}`;
		try {
			await writeSynced(candidatePath, bytes, 0o755);
			await copyFile(target, backupTemporaryPath, fsConstants.COPYFILE_EXCL);
			const backupHandle = await open(backupTemporaryPath, "r+");
			try {
				await backupHandle.chmod(0o755);
				await backupHandle.sync();
			} finally {
				await backupHandle.close();
			}
			await rename(backupTemporaryPath, backupPath);
			await rename(candidatePath, target);
			await syncDirectory(directory);
		} catch {
			throw updateError(
				"The verified Pi Router binary could not be installed.",
				"update_install_failed",
				500,
			);
		} finally {
			await rm(candidatePath, { force: true });
			await rm(backupTemporaryPath, { force: true });
		}
	}

	async #exclusive(action) {
		if (this.mutating) {
			throw updateError("Another update operation is already running.", "update_busy", 409);
		}
		this.mutating = true;
		try {
			return await action();
		} finally {
			this.mutating = false;
		}
	}

	async install(expectedVersion) {
		if (!parseVersion(expectedVersion)) {
			throw invalidRequest("version must be MAJOR.MINOR.PATCH.", "update_version_invalid");
		}
		return this.#exclusive(async () => {
			if (!this.binaryPath) {
				throw updateError(
					"Binary installation is unavailable in source mode.",
					"update_install_unsupported",
					409,
				);
			}
			if (this.pendingVersion) {
				throw updateError(
					"Restart Pi Router before another update operation.",
					"update_restart_required",
					409,
				);
			}
			const candidate = await this.#discover();
			if (candidate.version !== expectedVersion) {
				throw updateError(
					"The stable release changed; check again before installing.",
					"update_candidate_changed",
					409,
				);
			}
			if (compareVersions(candidate.version, this.currentVersion) <= 0) {
				throw updateError("Pi Router is already current.", "update_not_available", 409);
			}

			const [checksumBytes, binary] = await Promise.all([
				this.#fetch(
					candidate.checksum.url,
					MAX_CHECKSUM_BYTES,
					"Pi Router release checksum",
					"text/plain",
				),
				this.#fetch(
					candidate.asset.url,
					MAX_BINARY_BYTES,
					"Pi Router release binary",
					"application/octet-stream",
				),
			]);
			if (checksumBytes.length !== candidate.checksum.size) {
				throw updateError("The checksum asset size did not match GitHub metadata.", "update_checksum_size");
			}
			if (binary.length !== candidate.asset.size) {
				throw updateError("The binary size did not match GitHub metadata.", "update_asset_size");
			}
			const expectedChecksum = parseChecksum(checksumBytes.toString("utf8"));
			if (candidate.asset.digest && candidate.asset.digest !== expectedChecksum) {
				throw updateError("GitHub and release checksums disagree.", "update_checksum_mismatch");
			}
			const actualChecksum = createHash("sha256").update(binary).digest("hex");
			if (actualChecksum !== expectedChecksum) {
				throw updateError("The Pi Router release checksum did not match.", "update_checksum_mismatch");
			}
			validateAndroidElf(binary, { expectedVersion: candidate.version });
			await this.#replace(binary);
			this.pendingVersion = candidate.version;
			return {
				status: "installed",
				version: candidate.version,
				restart_required: true,
				sha256: actualChecksum,
			};
		});
	}

	async rollback() {
		return this.#exclusive(async () => {
			if (!this.binaryPath) {
				throw updateError(
					"Binary rollback is unavailable in source mode.",
					"update_rollback_unsupported",
					409,
				);
			}
			const backupPath = `${this.binaryPath}.previous`;
			const stat = await ownedRegularFile(backupPath, "The previous Pi Router binary");
			if (stat.size <= 0 || stat.size > MAX_BINARY_BYTES) {
				throw updateError("The previous Pi Router binary has an invalid size.", "update_binary_identity", 409);
			}
			const previous = await readFile(backupPath);
			validateAndroidElf(previous);
			await this.#replace(previous);
			this.pendingVersion = this.currentVersion;
			return {
				status: "rolled_back",
				restart_required: true,
			};
		});
	}

	async autoInstall() {
		const candidate = await this.check();
		if (candidate.status !== "available") {
			return candidate;
		}
		return this.install(candidate.latest_version);
	}
}
