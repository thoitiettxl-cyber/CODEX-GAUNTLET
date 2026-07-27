import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { invalidRequest } from "./errors.js";

const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function resolveStateDir(value, env = process.env) {
	const selected = value || env.PI_ROUTER_STATE_DIR || join(homedir(), ".local", "state", "pi-router");
	if (selected === "~") {
		return homedir();
	}
	if (selected.startsWith("~/")) {
		return resolve(homedir(), selected.slice(2));
	}
	return isAbsolute(selected) ? resolve(selected) : resolve(selected);
}

export function validateAccountId(accountId = "default") {
	if (!ACCOUNT_PATTERN.test(accountId) || accountId === "." || accountId === "..") {
		throw invalidRequest("Account id must contain only letters, numbers, dot, underscore, or hyphen.");
	}
	return accountId;
}

export function statePaths({ stateDir, accountId = "default" }) {
	const root = resolveStateDir(stateDir);
	const account = validateAccountId(accountId);
	const accountsDir = join(root, "accounts");
	const accountDir = join(accountsDir, account);
	return {
		root,
		account,
		accountsDir,
		accountDir,
		authPath: join(accountDir, "auth.json"),
		accountCatalogPath: join(root, "account-catalog.json"),
		configPath: join(root, "config.yaml"),
		modelsPath: join(root, "models.json"),
		providerPolicyPath: join(root, "provider-policy.json"),
		proxyKeysPath: join(root, "proxy-api-keys.json"),
	};
}

export async function ensureStatePaths(paths) {
	await mkdir(paths.accountDir, { recursive: true, mode: 0o700 });
	await chmod(paths.accountDir, 0o700);
}
