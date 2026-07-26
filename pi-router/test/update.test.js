import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	GithubUpdateManager,
	compareVersions,
	parseChecksum,
	parseVersion,
	selectRelease,
	validateAndroidElf,
} from "../src/update.js";
import { releaseArtifactMarker } from "../src/version.js";

function androidElf(
	marker = "candidate",
	version = "0.3.0",
	interpreter = "/system/bin/linker64",
) {
	const binary = Buffer.alloc(512, 0);
	Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(binary);
	binary.writeUInt16LE(183, 18);
	binary.writeBigUInt64LE(64n, 32);
	binary.writeUInt16LE(64, 52);
	binary.writeUInt16LE(56, 54);
	binary.writeUInt16LE(1, 56);
	binary.writeUInt32LE(3, 64);
	binary.writeBigUInt64LE(160n, 72);
	binary.writeBigUInt64LE(BigInt(Buffer.byteLength(interpreter) + 1), 96);
	Buffer.from(`${interpreter}\0`, "utf8").copy(binary, 160);
	Buffer.from(releaseArtifactMarker(version), "utf8").copy(binary, 256);
	Buffer.from(marker, "utf8").copy(binary, 384);
	return binary;
}

function release(version, binary, checksumText, overrides = {}) {
	const checksum = createHash("sha256").update(binary).digest("hex");
	return {
		tag_name: `pi-router-v${version}`,
		draft: false,
		prerelease: false,
		published_at: "2026-07-26T00:00:00Z",
		html_url: `http://updates.test/releases/${version}`,
		assets: [
			{
				name: "pi-router-android-aarch64",
				state: "uploaded",
				size: binary.length,
				digest: `sha256:${checksum}`,
				browser_download_url: `http://updates.test/assets/${version}/binary`,
			},
			{
				name: "pi-router-android-aarch64.sha256",
				state: "uploaded",
				size: Buffer.byteLength(checksumText),
				browser_download_url: `http://updates.test/assets/${version}/checksum`,
			},
		],
		...overrides,
	};
}

function releaseFixture(version = "0.3.0", marker = "candidate") {
	const binary = androidElf(marker, version);
	const checksum = createHash("sha256").update(binary).digest("hex");
	const checksumText = `${checksum}  pi-router-android-aarch64\n`;
	return {
		binary,
		checksum,
		checksumText,
		release: release(version, binary, checksumText),
	};
}

function fakeFetch(releases, fixture, { checksumText = fixture.checksumText } = {}) {
	return async (url) => {
		const value = String(url);
		if (value.includes("/releases?")) {
			return new Response(JSON.stringify(releases), {
				headers: { "content-type": "application/json" },
			});
		}
		if (value.endsWith("/checksum")) {
			return new Response(checksumText, {
				headers: { "content-length": String(Buffer.byteLength(checksumText)) },
			});
		}
		if (value.endsWith("/binary")) {
			return new Response(fixture.binary, {
				headers: { "content-length": String(fixture.binary.length) },
			});
		}
		throw new Error(`unexpected URL ${value}`);
	};
}

function manager(fixture, options = {}) {
	return new GithubUpdateManager({
		currentVersion: "0.2.0",
		apiBase: "http://updates.test",
		fetchImpl: fakeFetch([fixture.release], fixture),
		allowInsecureForTests: true,
		...options,
	});
}

test("strict versions compare numerically and reject ambiguous values", () => {
	assert.deepEqual(parseVersion("12.3.40"), [12, 3, 40]);
	assert.equal(parseVersion("1.02.3"), null);
	assert.equal(parseVersion("v1.2.3"), null);
	assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
	assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
	assert.equal(compareVersions("0.9.0", "1.0.0"), -1);
	assert.throws(() => compareVersions("latest", "1.0.0"), /MAJOR/);
});

test("release selection ignores other products and chooses the newest stable Pi Router tag", () => {
	const older = releaseFixture("0.2.1", "older");
	const newer = releaseFixture("1.0.0", "newer");
	const selected = selectRelease([
		{ ...newer.release, tag_name: "harness-v9.0.0" },
		{ ...newer.release, prerelease: true },
		older.release,
		newer.release,
	], { allowInsecure: true });
	assert.equal(selected.version, "1.0.0");
	assert.equal(selected.asset.name, "pi-router-android-aarch64");
	assert.equal(selected.asset.url, "http://updates.test/assets/1.0.0/binary");
	assert.throws(
		() => selectRelease([{ ...newer.release, assets: [] }], { allowInsecure: true }),
		(error) => error.code === "update_assets_missing",
	);
});

test("checksums and Android ELF identity are exact", () => {
	const fixture = releaseFixture();
	assert.equal(parseChecksum(fixture.checksumText), fixture.checksum);
	assert.deepEqual(validateAndroidElf(fixture.binary, { expectedVersion: "0.3.0" }), {
		format: "ELF64",
		machine: "AArch64",
		interpreter: "/system/bin/linker64",
	});
	assert.throws(
		() => validateAndroidElf(fixture.binary, { expectedVersion: "0.4.0" }),
		(error) => error.code === "update_binary_version",
	);
	assert.throws(
		() => parseChecksum(`${fixture.checksum}  another-file\n`),
		(error) => error.code === "update_checksum_invalid",
	);
	const linux = androidElf("linux", "0.3.0", "/lib/ld-linux-aarch64.so.1");
	Buffer.from("/system/bin/linker64\0", "utf8").copy(linux, 448);
	assert.throws(
		() => validateAndroidElf(linux),
		(error) => error.code === "update_binary_identity",
	);
});

test("release requests reject unpublished metadata and HTTPS downgrade redirects", async () => {
	const fixture = releaseFixture();
	assert.throws(
		() => selectRelease([{ ...fixture.release, published_at: null }], { allowInsecure: true }),
		(error) => error.code === "update_release_not_found",
	);
	const updater = new GithubUpdateManager({
		currentVersion: "0.2.0",
		apiBase: "https://updates.test",
		async fetchImpl() {
			return new Response(null, {
				status: 302,
				headers: { location: "http://updates.test/releases" },
			});
		},
	});
	await assert.rejects(
		updater.check(),
		(error) => error.code === "update_release_invalid",
	);
});

test("release checks expose a bounded candidate without asset URLs", async () => {
	const fixture = releaseFixture("0.4.0");
	const result = await manager(fixture).check();
	assert.deepEqual(result, {
		status: "available",
		current_version: "0.2.0",
		latest_version: "0.4.0",
		published_at: "2026-07-26T00:00:00Z",
		release_url: "http://updates.test/releases/0.4.0",
		asset: {
			name: "pi-router-android-aarch64",
			size: fixture.binary.length,
		},
	});
	assert.doesNotMatch(JSON.stringify(result), /\/assets\//);
});

test("verified install replaces atomically and rollback swaps the retained binary", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-update-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "pi-router");
	const original = androidElf("original");
	await writeFile(target, original, { mode: 0o755 });
	const fixture = releaseFixture("0.3.0", "installed");
	const updater = manager(fixture, { binaryPath: target });

	const installed = await updater.install("0.3.0");
	assert.equal(installed.status, "installed");
	assert.equal(installed.restart_required, true);
	assert.deepEqual(await readFile(target), fixture.binary);
	assert.deepEqual(await readFile(`${target}.previous`), original);
	assert.equal((await stat(target)).mode & 0o777, 0o755);
	assert.deepEqual(await updater.status(), {
		repository: "thoitiettxl-cyber/codex-gauntlet-termux",
		channel: "stable",
		automatic: false,
		install_supported: true,
		rollback_available: true,
		restart_required: true,
		pending_version: "0.3.0",
	});

	const rolledBack = await updater.rollback();
	assert.equal(rolledBack.status, "rolled_back");
	assert.deepEqual(await readFile(target), original);
	assert.deepEqual(await readFile(`${target}.previous`), fixture.binary);
});

test("checksum failure and source mode leave the executable untouched", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-update-failure-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "pi-router");
	const original = androidElf("original");
	await writeFile(target, original, { mode: 0o755 });
	const fixture = releaseFixture();
	const badChecksum = `${"0".repeat(64)}  pi-router-android-aarch64\n`;
	const updater = new GithubUpdateManager({
		currentVersion: "0.2.0",
		apiBase: "http://updates.test",
		fetchImpl: fakeFetch(
			[{ ...fixture.release, assets: fixture.release.assets.map((asset) => (
				asset.name.endsWith(".sha256")
					? { ...asset, size: Buffer.byteLength(badChecksum) }
					: { ...asset, digest: undefined }
			)) }],
			fixture,
			{ checksumText: badChecksum },
		),
		binaryPath: target,
		allowInsecureForTests: true,
	});
	await assert.rejects(
		updater.install("0.3.0"),
		(error) => error.code === "update_checksum_mismatch",
	);
	assert.deepEqual(await readFile(target), original);
	await assert.rejects(
		manager(fixture).install("0.3.0"),
		(error) => error.code === "update_install_unsupported",
	);
});

test("download bounds reject oversized release bodies before replacement", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-update-bounds-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "pi-router");
	const original = androidElf("original");
	await writeFile(target, original, { mode: 0o755 });
	const fixture = releaseFixture();
	const boundedRelease = {
		...fixture.release,
		assets: fixture.release.assets.map((asset) => (
			asset.name.endsWith(".sha256") ? { ...asset, size: 1 } : asset
		)),
	};
	const updater = new GithubUpdateManager({
		currentVersion: "0.2.0",
		apiBase: "http://updates.test",
		binaryPath: target,
		allowInsecureForTests: true,
		async fetchImpl(url) {
			if (String(url).includes("/releases?")) {
				return new Response(JSON.stringify([boundedRelease]));
			}
			if (String(url).endsWith("/checksum")) {
				return new Response("oversized", {
					headers: { "content-length": String(16 * 1024 + 1) },
				});
			}
			return new Response(fixture.binary);
		},
	});
	await assert.rejects(
		updater.install("0.3.0"),
		(error) => error.code === "update_response_too_large",
	);
	assert.deepEqual(await readFile(target), original);
});

test("install rejects stale versions and serializes update mutations", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-update-lock-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "pi-router");
	await writeFile(target, androidElf("original"), { mode: 0o755 });
	const fixture = releaseFixture();

	await assert.rejects(
		manager(fixture, { binaryPath: target }).install("0.4.0"),
		(error) => error.code === "update_candidate_changed",
	);

	let releaseFetchStarted;
	const started = new Promise((resolve) => {
		releaseFetchStarted = resolve;
	});
	let releaseFetchContinue;
	const continuation = new Promise((resolve) => {
		releaseFetchContinue = resolve;
	});
	const updater = new GithubUpdateManager({
		currentVersion: "0.2.0",
		apiBase: "http://updates.test",
		binaryPath: target,
		allowInsecureForTests: true,
		async fetchImpl(url) {
			if (String(url).includes("/releases?")) {
				releaseFetchStarted();
				await continuation;
			}
			return fakeFetch([fixture.release], fixture)(url);
		},
	});
	const first = updater.install("0.3.0");
	await started;
	await assert.rejects(
		updater.rollback(),
		(error) => error.code === "update_busy",
	);
	releaseFetchContinue();
	await first;
	await chmod(target, 0o755);
});
