import {
	createHash,
	randomUUID,
} from "node:crypto";
import {
	chmod,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { RouterError, invalidRequest } from "./errors.js";
import { ensureStatePaths, statePaths, validateAccountId } from "./paths.js";

const CATALOG_VERSION = 1;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const MAX_ACCOUNTS = 256;
const MAX_CREDENTIALS_PER_ACCOUNT = 128;
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CREDENTIAL_PATTERN = /^cred_[a-f0-9]{24}$/u;

function iso(value) {
	return new Date(value).toISOString();
}

function boundedLabel(value, fallback) {
	const normalized = typeof value === "string"
		? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim()
		: "";
	return (normalized || fallback).slice(0, 96);
}

function stableCredentialId(accountId, providerId) {
	const hash = createHash("sha256")
		.update(accountId)
		.update("\0")
		.update(providerId)
		.digest("hex")
		.slice(0, 24);
	return `cred_${hash}`;
}

function validCredential(entry, providerId, accountId) {
	const metadata = entry?.metadata;
	const validMetadata = metadata === undefined || (
		metadata
		&& typeof metadata === "object"
		&& !Array.isArray(metadata)
		&& Object.keys(metadata).every((key) =>
			["project_id", "account_id", "user_id"].includes(key))
		&& Object.values(metadata).every((value) =>
			typeof value === "string" && value.length >= 1 && value.length <= 256)
	);
	return (
		entry
		&& typeof entry === "object"
		&& !Array.isArray(entry)
		&& CREDENTIAL_PATTERN.test(entry.id)
		&& entry.id === stableCredentialId(accountId, providerId)
		&& ["api_key", "oauth"].includes(entry.type)
		&& typeof entry.label === "string"
		&& entry.label.length >= 1
		&& entry.label.length <= 96
		&& Number.isFinite(Date.parse(entry.created_at))
		&& Number.isFinite(Date.parse(entry.updated_at))
		&& validMetadata
	);
}

function validAccount(entry, accountId) {
	if (
		!entry
		|| typeof entry !== "object"
		|| Array.isArray(entry)
		|| typeof entry.label !== "string"
		|| entry.label.length < 1
		|| entry.label.length > 96
		|| !Number.isFinite(Date.parse(entry.created_at))
		|| !Number.isFinite(Date.parse(entry.updated_at))
		|| !entry.credentials
		|| typeof entry.credentials !== "object"
		|| Array.isArray(entry.credentials)
	) {
		return false;
	}
	const credentials = Object.entries(entry.credentials);
	return (
		credentials.length <= MAX_CREDENTIALS_PER_ACCOUNT
		&& credentials.every(([providerId, credential]) =>
			PROVIDER_PATTERN.test(providerId) && validCredential(credential, providerId, accountId))
	);
}

function validateCatalog(document) {
	if (
		!document
		|| typeof document !== "object"
		|| Array.isArray(document)
		|| document.version !== CATALOG_VERSION
		|| !document.accounts
		|| typeof document.accounts !== "object"
		|| Array.isArray(document.accounts)
	) {
		throw new RouterError("Account catalog is invalid.", {
			status: 500,
			code: "account_catalog_invalid",
			expose: true,
		});
	}
	const accounts = Object.entries(document.accounts);
	if (
		accounts.length > MAX_ACCOUNTS
		|| accounts.some(([accountId, account]) => {
			try {
				validateAccountId(accountId);
				return !validAccount(account, accountId);
			} catch {
				return true;
			}
		})
	) {
		throw new RouterError("Account catalog is invalid.", {
			status: 500,
			code: "account_catalog_invalid",
			expose: true,
		});
	}
	return document;
}

async function syncDirectory(path) {
	let handle;
	try {
		handle = await open(path, "r");
		await handle.sync();
	} finally {
		await handle?.close();
	}
}

async function atomicWrite(path, document) {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
		await chmod(path, 0o600);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

async function atomicWriteBytes(path, source) {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(source);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
		await chmod(path, 0o600);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

function validateAuthFile(source) {
	const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? "");
	if (bytes.length === 0 || bytes.length > MAX_AUTH_FILE_BYTES) {
		throw invalidRequest(
			`Credential file must be between 1 and ${MAX_AUTH_FILE_BYTES} bytes.`,
			"credential_file_invalid",
		);
	}
	let document;
	try {
		document = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw invalidRequest("Credential file must be valid JSON.", "credential_file_invalid");
	}
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw invalidRequest(
			"Credential file must contain a JSON object.",
			"credential_file_invalid",
		);
	}
	const entries = Object.entries(document);
	if (
		entries.length === 0
		|| entries.length > MAX_CREDENTIALS_PER_ACCOUNT
		|| entries.some(([providerId, credential]) =>
			!PROVIDER_PATTERN.test(providerId)
			|| !credential
			|| typeof credential !== "object"
			|| Array.isArray(credential)
			|| !["api_key", "oauth"].includes(credential.type))
	) {
		throw invalidRequest(
			"Credential file contains an invalid provider or credential.",
			"credential_file_invalid",
		);
	}
	return { bytes, providers: entries.map(([providerId]) => providerId) };
}

async function readCatalog(path) {
	let metadata;
	try {
		metadata = await stat(path);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.size > MAX_CATALOG_BYTES) {
		throw new RouterError("Account catalog is invalid.", {
			status: 500,
			code: "account_catalog_invalid",
			expose: true,
		});
	}
	const bytes = await readFile(path);
	if (bytes.length > MAX_CATALOG_BYTES) {
		throw new RouterError("Account catalog is invalid.", {
			status: 500,
			code: "account_catalog_invalid",
			expose: true,
		});
	}
	try {
		return validateCatalog(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		if (error instanceof RouterError) {
			throw error;
		}
		throw new RouterError("Account catalog is not valid JSON.", {
			status: 500,
			code: "account_catalog_invalid",
			expose: true,
		});
	}
}

function decodeJwtClaims(token) {
	if (typeof token !== "string") {
		return undefined;
	}
	const parts = token.split(".");
	if (parts.length < 2) {
		return undefined;
	}
	try {
		const value = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function identityLabel(credential) {
	if (!credential || typeof credential !== "object") {
		return undefined;
	}
	for (const key of ["email", "name", "username", "accountId", "account_id"]) {
		const selected = boundedLabel(credential[key], "");
		if (selected) {
			return selected;
		}
	}
	const claims = decodeJwtClaims(credential.access);
	if (!claims) {
		return undefined;
	}
	const authentication = claims["https://api.openai.com/auth"];
	for (const value of [
		claims.email,
		claims.preferred_username,
		claims.name,
		authentication?.user_email,
		authentication?.chatgpt_account_id,
		claims.sub,
	]) {
		const selected = boundedLabel(value, "");
		if (selected) {
			return selected;
		}
	}
	return undefined;
}

function credentialMetadata(credential, fallback = {}) {
	const metadata = { ...fallback };
	for (const [target, candidates] of Object.entries({
		project_id: ["projectId", "project_id"],
		account_id: ["accountId", "account_id"],
		user_id: ["userId", "user_id"],
	})) {
		for (const candidate of candidates) {
			const selected = boundedLabel(credential?.[candidate], "");
			if (selected) {
				metadata[target] = selected.slice(0, 256);
				break;
			}
		}
	}
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function publicCredential(accountId, account, providerId, credential, activeAccount) {
	return {
		id: credential.id,
		account_id: accountId,
		account_label: account.label,
		provider_id: providerId,
		type: credential.type,
		label: credential.label,
		active: accountId === activeAccount,
		created_at: credential.created_at,
		updated_at: credential.updated_at,
	};
}

export class AccountCatalog {
	constructor({ path, accountsDir, document, now = Date.now, id = randomUUID } = {}) {
		this.path = path;
		this.accountsDir = accountsDir;
		this.document = document;
		this.now = now;
		this.id = id;
		this.mutation = Promise.resolve();
	}

	static async open({
		path,
		accountsDir,
		activeAccount = "default",
		now = Date.now,
		id = randomUUID,
	} = {}) {
		if (!path || !accountsDir) {
			throw new TypeError("account catalog paths are required");
		}
		await mkdir(accountsDir, { recursive: true, mode: 0o700 });
		let document = await readCatalog(path);
		let changed = false;
		if (!document) {
			document = { version: CATALOG_VERSION, accounts: {} };
			changed = true;
		}
		let entries = [];
		try {
			entries = await readdir(accountsDir, { withFileTypes: true });
		} catch (error) {
			if (error?.code !== "ENOENT") {
				throw error;
			}
		}
		const accountIds = new Set([
			activeAccount,
			...entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
		]);
		for (const accountId of accountIds) {
			try {
				validateAccountId(accountId);
			} catch {
				continue;
			}
			if (!document.accounts[accountId]) {
				const timestamp = iso(now());
				document.accounts[accountId] = {
					label: boundedLabel(accountId, "Account"),
					created_at: timestamp,
					updated_at: timestamp,
					credentials: {},
				};
				changed = true;
			}
		}
		if (changed) {
			validateCatalog(document);
			await atomicWrite(path, document);
		}
		return new AccountCatalog({ path, accountsDir, document, now, id });
	}

	#run(operation) {
		const pending = this.mutation.then(operation);
		this.mutation = pending.catch(() => {});
		return pending;
	}

	async #write(document) {
		validateCatalog(document);
		await atomicWrite(this.path, document);
		this.document = document;
	}

	accountIds() {
		return Object.keys(this.document.accounts).sort();
	}

	account(accountId) {
		return this.document.accounts[accountId];
	}

	createAccount(providerId) {
		return this.#run(async () => {
			if (this.accountIds().length >= MAX_ACCOUNTS) {
				throw new RouterError("Account capacity is full.", {
					status: 409,
					code: "account_capacity",
					type: "invalid_request_error",
				});
			}
			const normalizedProvider = PROVIDER_PATTERN.test(providerId) ? providerId : "provider";
			let accountId;
			do {
				accountId = `acct-${normalizedProvider.slice(0, 24)}-${this.id().slice(0, 8)}`;
			} while (this.document.accounts[accountId]);
			validateAccountId(accountId);
			const timestamp = iso(this.now());
			const account = {
				label: boundedLabel(`${normalizedProvider} ${accountId.slice(-8)}`, accountId),
				created_at: timestamp,
				updated_at: timestamp,
				credentials: {},
			};
			await mkdir(join(this.accountsDir, accountId), { recursive: true, mode: 0o700 });
			await this.#write({
				version: CATALOG_VERSION,
				accounts: {
					...this.document.accounts,
					[accountId]: account,
				},
			});
			return { account_id: accountId, account_label: account.label };
		});
	}

	ensureAccount(accountId) {
		return this.#run(async () => {
			const selected = validateAccountId(accountId);
			const existing = this.document.accounts[selected];
			if (existing) {
				return { account_id: selected, account_label: existing.label };
			}
			if (this.accountIds().length >= MAX_ACCOUNTS) {
				throw new RouterError("Account capacity is full.", {
					status: 409,
					code: "account_capacity",
					type: "invalid_request_error",
				});
			}
			const timestamp = iso(this.now());
			const account = {
				label: boundedLabel(selected, "Account"),
				created_at: timestamp,
				updated_at: timestamp,
				credentials: {},
			};
			await mkdir(join(this.accountsDir, selected), { recursive: true, mode: 0o700 });
			await this.#write({
				version: CATALOG_VERSION,
				accounts: { ...this.document.accounts, [selected]: account },
			});
			return { account_id: selected, account_label: account.label };
		});
	}

	upsertCredential({
		accountId,
		providerId,
		providerName,
		type,
		label,
		credential,
		activeAccount,
	} = {}) {
		return this.#run(async () => {
			const account = this.document.accounts[validateAccountId(accountId)];
			if (!account || !PROVIDER_PATTERN.test(providerId)) {
				throw invalidRequest("Credential account or provider is invalid.");
			}
			if (!["api_key", "oauth"].includes(type)) {
				throw invalidRequest("Credential type is invalid.");
			}
			const id = stableCredentialId(accountId, providerId);
			const existing = account.credentials[providerId];
			if (
				existing
				&& credential === undefined
				&& label === undefined
				&& existing.type === type
			) {
				return publicCredential(
					accountId,
					account,
					providerId,
					existing,
					activeAccount,
				);
			}
			const requested = boundedLabel(
				label,
				identityLabel(credential)
					?? existing?.label
					?? `${boundedLabel(providerName, providerId)} · ${account.label}`,
			);
			const used = new Set();
			for (const [otherAccountId, otherAccount] of Object.entries(this.document.accounts)) {
				const other = otherAccount.credentials[providerId];
				if (other && !(otherAccountId === accountId && other.id === id)) {
					used.add(other.label.toLocaleLowerCase("en-US"));
				}
			}
			let unique = requested;
			for (let suffix = 2; used.has(unique.toLocaleLowerCase("en-US")); suffix += 1) {
				const marker = ` (${suffix})`;
				unique = `${requested.slice(0, 96 - marker.length)}${marker}`;
			}
			const timestamp = iso(this.now());
			const nextCredential = {
				id,
				type,
				label: unique,
				created_at: existing?.created_at ?? timestamp,
				updated_at: timestamp,
				metadata: credentialMetadata(credential, existing?.metadata),
			};
			if (!nextCredential.metadata) {
				delete nextCredential.metadata;
			}
			const nextAccount = {
				...account,
				label: Object.keys(account.credentials).length === 0
					? unique
					: account.label,
				updated_at: timestamp,
				credentials: {
					...account.credentials,
					[providerId]: nextCredential,
				},
			};
			await this.#write({
				version: CATALOG_VERSION,
				accounts: {
					...this.document.accounts,
					[accountId]: nextAccount,
				},
			});
			return publicCredential(
				accountId,
				nextAccount,
				providerId,
				nextCredential,
				activeAccount,
			);
		});
	}

	reconcileAccount(accountId, observedProviders) {
		return this.#run(async () => {
			const selected = validateAccountId(accountId);
			const account = this.document.accounts[selected];
			if (!account) {
				throw invalidRequest("Credential account is invalid.");
			}
			const observed = new Set(observedProviders);
			const credentials = Object.fromEntries(
				Object.entries(account.credentials)
					.filter(([providerId]) => observed.has(providerId)),
			);
			if (
				Object.keys(credentials).length
				=== Object.keys(account.credentials).length
			) {
				return false;
			}
			const timestamp = iso(this.now());
			await this.#write({
				version: CATALOG_VERSION,
				accounts: {
					...this.document.accounts,
					[selected]: {
						...account,
						updated_at: timestamp,
						credentials,
					},
				},
			});
			return true;
		});
	}

	removeCredential(credentialId) {
		return this.#run(async () => {
			for (const [accountId, account] of Object.entries(this.document.accounts)) {
				for (const [providerId, credential] of Object.entries(account.credentials)) {
					if (credential.id !== credentialId) {
						continue;
					}
					const credentials = { ...account.credentials };
					delete credentials[providerId];
					const timestamp = iso(this.now());
					await this.#write({
						version: CATALOG_VERSION,
						accounts: {
							...this.document.accounts,
							[accountId]: {
								...account,
								updated_at: timestamp,
								credentials,
							},
						},
					});
					return { accountId, providerId };
				}
			}
			return undefined;
		});
	}

	findCredential(credentialId, activeAccount) {
		for (const [accountId, account] of Object.entries(this.document.accounts)) {
			for (const [providerId, credential] of Object.entries(account.credentials)) {
				if (credential.id === credentialId) {
					return publicCredential(
						accountId,
						account,
						providerId,
						credential,
						activeAccount,
					);
				}
			}
		}
		return undefined;
	}

	quotaMetadata(credentialId) {
		for (const account of Object.values(this.document.accounts)) {
			for (const credential of Object.values(account.credentials)) {
				if (credential.id === credentialId) {
					return credential.metadata ? { ...credential.metadata } : {};
				}
			}
		}
		return {};
	}

	listCredentials(activeAccount) {
		const result = [];
		for (const [accountId, account] of Object.entries(this.document.accounts)) {
			for (const [providerId, credential] of Object.entries(account.credentials)) {
				result.push(publicCredential(
					accountId,
					account,
					providerId,
					credential,
					activeAccount,
				));
			}
		}
		return result;
	}
}

export class AccountRuntimePool {
	constructor({
		paths,
		activeRuntime,
		catalog,
		createRuntime,
		allowModelNetwork = false,
		additionalRuntimeOptions = {},
	} = {}) {
		this.paths = paths;
		this.activeAccount = paths.account;
		this.activeRuntime = activeRuntime;
		this.catalog = catalog;
		this.createRuntime = createRuntime;
		this.allowModelNetwork = allowModelNetwork;
		this.additionalRuntimeOptions = additionalRuntimeOptions;
		this.runtimes = new Map([[paths.account, Promise.resolve(activeRuntime)]]);
	}

	static async create({
		paths,
		activeRuntime,
		createRuntime,
		allowModelNetwork = false,
		additionalRuntimeOptions = {},
		now = Date.now,
		id = randomUUID,
	} = {}) {
		if (!paths || !activeRuntime || typeof createRuntime !== "function") {
			throw new TypeError("account runtime pool options are required");
		}
		const catalog = await AccountCatalog.open({
			path: paths.accountCatalogPath,
			accountsDir: paths.accountsDir,
			activeAccount: paths.account,
			now,
			id,
		});
		return new AccountRuntimePool({
			paths,
			activeRuntime,
			catalog,
			createRuntime,
			allowModelNetwork,
			additionalRuntimeOptions,
		});
	}

	async #runtime(accountId) {
		const selected = validateAccountId(accountId);
		let pending = this.runtimes.get(selected);
		if (!pending) {
			pending = (async () => {
				const paths = statePaths({
					stateDir: this.paths.root,
					accountId: selected,
				});
				await ensureStatePaths(paths);
				return this.createRuntime({
					...this.additionalRuntimeOptions,
					authPath: paths.authPath,
					modelsPath: paths.modelsPath,
					providerPolicyPath: paths.providerPolicyPath,
					allowModelNetwork: this.allowModelNetwork,
				});
			})();
			this.runtimes.set(selected, pending);
		}
		try {
			return await pending;
		} catch (error) {
			this.runtimes.delete(selected);
			throw error;
		}
	}

	listModels() {
		return this.activeRuntime.listModels();
	}

	resolveModel(name) {
		return this.activeRuntime.resolveModel(name);
	}

	stream(model, context, options) {
		return this.activeRuntime.stream(model, context, options);
	}

	async listProviderMetadata() {
		const [providers, credentials] = await Promise.all([
			this.activeRuntime.listProviderMetadata(),
			this.listCredentialMetadata(),
		]);
		return providers.map((provider) => ({
			...provider,
			credential_count: credentials.filter((entry) =>
				entry.provider_id === provider.id).length,
		}));
	}

	async listCredentialMetadata() {
		const providerNames = new Map(
			(await this.activeRuntime.listProviderMetadata())
				.map((provider) => [provider.id, provider.name]),
		);
		for (const accountId of this.catalog.accountIds()) {
			const runtime = await this.#runtime(accountId);
			const credentials = await runtime.listCredentialMetadata();
			for (const credential of credentials) {
				await this.catalog.upsertCredential({
					accountId,
					providerId: credential.provider_id,
					providerName: credential.provider_name,
					type: credential.type,
					activeAccount: this.activeAccount,
				});
				providerNames.set(credential.provider_id, credential.provider_name);
			}
			await this.catalog.reconcileAccount(
				accountId,
				credentials.map((credential) => credential.provider_id),
			);
		}
		return this.catalog.listCredentials(this.activeAccount).map((credential) => ({
			...credential,
			provider_name: providerNames.get(credential.provider_id) ?? credential.provider_id,
		}));
	}

	async prepareLogin({ providerId, accountId } = {}) {
		return accountId
			? this.catalog.ensureAccount(accountId)
			: this.catalog.createAccount(providerId);
	}

	async login(providerId, type, interaction, {
		accountId = this.activeAccount,
		label,
	} = {}) {
		await this.catalog.ensureAccount(accountId);
		const runtime = await this.#runtime(accountId);
		const provider = typeof runtime.listProviderMetadata === "function"
			? (await runtime.listProviderMetadata())
				.find((entry) => entry.id === providerId)
			: undefined;
		const credential = await runtime.login(providerId, type, interaction);
		return this.catalog.upsertCredential({
			accountId,
			providerId,
			providerName: provider?.name ?? providerId,
			type,
			label,
			credential,
			activeAccount: this.activeAccount,
		});
	}

	async logoutCredential(credentialId) {
		const credential = this.catalog.findCredential(credentialId, this.activeAccount);
		if (!credential) {
			return undefined;
		}
		const runtime = await this.#runtime(credential.account_id);
		await runtime.logout(credential.provider_id);
		await this.catalog.removeCredential(credentialId);
		return credential;
	}

	async logout(providerId) {
		await this.activeRuntime.logout(providerId);
		const credential = this.catalog.listCredentials(this.activeAccount)
			.find((entry) =>
				entry.account_id === this.activeAccount && entry.provider_id === providerId);
		if (credential) {
			await this.catalog.removeCredential(credential.id);
		}
	}

	async exportAuthFile(credentialId) {
		const credential = this.catalog.findCredential(credentialId, this.activeAccount);
		if (!credential) {
			throw new RouterError("Credential file was not found.", {
				status: 404,
				code: "credential_file_not_found",
				type: "invalid_request_error",
			});
		}
		const paths = statePaths({
			stateDir: this.paths.root,
			accountId: credential.account_id,
		});
		const source = await readFile(paths.authPath);
		validateAuthFile(source);
		return {
			source,
			filename: `${credential.account_id}-auth.json`,
			account_id: credential.account_id,
			credential_id: credential.id,
		};
	}

	async importAuthFile(source) {
		const validated = validateAuthFile(source);
		const account = await this.catalog.createAccount(validated.providers[0]);
		const paths = statePaths({
			stateDir: this.paths.root,
			accountId: account.account_id,
		});
		await atomicWriteBytes(paths.authPath, validated.bytes);
		const runtime = await this.#runtime(account.account_id);
		if (typeof runtime.reloadCredentials === "function") {
			await runtime.reloadCredentials();
		}
		const credentials = await runtime.listCredentialMetadata();
		if (credentials.length !== validated.providers.length) {
			throw invalidRequest(
				"Credential file could not be loaded by the runtime.",
				"credential_file_invalid",
			);
		}
		for (const credential of credentials) {
			await this.catalog.upsertCredential({
				accountId: account.account_id,
				providerId: credential.provider_id,
				providerName: credential.provider_name,
				type: credential.type,
				activeAccount: this.activeAccount,
			});
		}
		return {
			object: "pi_router.credential_import",
			status: "imported",
			account_id: account.account_id,
			credentials: this.catalog.listCredentials(this.activeAccount)
				.filter((credential) => credential.account_id === account.account_id),
		};
	}

	async quotaCredentialContexts() {
		const credentials = await this.listCredentialMetadata();
		return Promise.all(credentials.map(async (credential) => {
			const runtime = await this.#runtime(credential.account_id);
			return {
				...credential,
				quota_metadata: this.catalog.quotaMetadata(credential.id),
				resolveAuth: () => runtime.resolveAuth(credential.provider_id),
			};
		}));
	}

	async refreshConfiguration() {
		const runtimes = await Promise.all([...this.runtimes.values()]);
		await Promise.all(runtimes.map((runtime) => runtime.refreshConfiguration()));
	}
}
