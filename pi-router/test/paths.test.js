import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureStatePaths, statePaths, validateAccountId } from "../src/paths.js";

test("state paths keep accounts below the selected state root", async (t) => {
	const root = await import("node:fs/promises").then(({ mkdtemp }) =>
		mkdtemp(join(tmpdir(), "pi-router-paths-")),
	);
	t.after(async () => {
		await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
	});
	const paths = statePaths({ stateDir: root, accountId: "work_1" });
	assert.equal(paths.accountsDir, join(root, "accounts"));
	assert.equal(paths.authPath, join(root, "accounts", "work_1", "auth.json"));
	assert.equal(paths.accountCatalogPath, join(root, "account-catalog.json"));
	assert.equal(paths.modelsPath, join(root, "models.json"));
	assert.equal(paths.providerPolicyPath, join(root, "provider-policy.json"));
	assert.equal(paths.proxyKeysPath, join(root, "proxy-api-keys.json"));
	await ensureStatePaths(paths);
	const metadata = await stat(paths.accountDir);
	assert.equal(metadata.isDirectory(), true);
	assert.equal(metadata.mode & 0o777, 0o700);
});

test("account ids cannot escape the state directory", () => {
	for (const value of ["../secret", "/tmp/x", "", "a/b", ".."]) {
		assert.throws(() => validateAccountId(value), /Account id/);
	}
});
