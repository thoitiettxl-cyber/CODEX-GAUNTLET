import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import {
	chmod,
	mkdir,
	open,
	readFile,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { RouterError, invalidRequest } from "./errors.js";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 64 * 1024;
const MAX_KEYS = 128;
const KEY_ID_PATTERN = /^key_[0-9a-f-]{36}$/u;

function iso(value) {
	return new Date(value).toISOString();
}

function digest(value) {
	return createHash("sha256").update(value).digest("hex");
}

function validTimestamp(value) {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validEntry(entry) {
	return (
		entry
		&& typeof entry === "object"
		&& !Array.isArray(entry)
		&& KEY_ID_PATTERN.test(entry.id)
		&& typeof entry.label === "string"
		&& entry.label.length >= 1
		&& entry.label.length <= 80
		&& /^[a-f0-9]{64}$/u.test(entry.digest)
		&& validTimestamp(entry.created_at)
		&& validTimestamp(entry.updated_at)
	);
}

function validateDocument(document) {
	if (
		!document
		|| typeof document !== "object"
		|| Array.isArray(document)
		|| document.version !== STORE_VERSION
		|| !Array.isArray(document.keys)
		|| document.keys.length > MAX_KEYS
		|| document.keys.some((entry) => !validEntry(entry))
	) {
		throw new RouterError("Proxy API-key store is invalid.", {
			status: 500,
			code: "proxy_key_store_invalid",
			expose: true,
		});
	}
	const ids = new Set(document.keys.map((entry) => entry.id));
	if (ids.size !== document.keys.length) {
		throw new RouterError("Proxy API-key store contains duplicate ids.", {
			status: 500,
			code: "proxy_key_store_invalid",
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

async function readStore(path) {
	let metadata;
	try {
		metadata = await stat(path);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
		throw new RouterError("Proxy API-key store is invalid.", {
			status: 500,
			code: "proxy_key_store_invalid",
			expose: true,
		});
	}
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		throw new RouterError("Proxy API-key store could not be read.", {
			status: 500,
			code: "proxy_key_store_unavailable",
			expose: true,
			cause: error,
		});
	}
	if (bytes.length > MAX_STORE_BYTES) {
		throw new RouterError("Proxy API-key store is invalid.", {
			status: 500,
			code: "proxy_key_store_invalid",
			expose: true,
		});
	}
	try {
		return validateDocument(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		if (error instanceof RouterError) {
			throw error;
		}
		throw new RouterError("Proxy API-key store is not valid JSON.", {
			status: 500,
			code: "proxy_key_store_invalid",
			expose: true,
		});
	}
}

function label(value, fallback = "Proxy API key") {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== "string") {
		throw invalidRequest("label must be a string.", "invalid_proxy_key_label");
	}
	const selected = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
	if (selected.length < 1 || selected.length > 80) {
		throw invalidRequest(
			"label must be between 1 and 80 characters.",
			"invalid_proxy_key_label",
		);
	}
	return selected;
}

function publicEntry(entry) {
	return {
		id: entry.id,
		label: entry.label,
		created_at: entry.created_at,
		updated_at: entry.updated_at,
	};
}

function keyValue(random = randomBytes) {
	return `prk_${random(32).toString("base64url")}`;
}

export class ProxyKeyStore {
	constructor({
		path,
		document,
		now = Date.now,
		random = randomBytes,
		id = randomUUID,
	} = {}) {
		this.path = path;
		this.document = document;
		this.now = now;
		this.random = random;
		this.id = id;
		this.mutation = Promise.resolve();
	}

	static async open({
		path,
		seedKey,
		now = Date.now,
		random = randomBytes,
		id = randomUUID,
		requireKey = false,
	} = {}) {
		if (typeof path !== "string" || path.length === 0) {
			throw new TypeError("proxy key store path is required");
		}
		let document = await readStore(path);
		if (!document) {
			document = { version: STORE_VERSION, keys: [] };
			if (typeof seedKey === "string" && seedKey.trim().length > 0) {
				const timestamp = iso(now());
				document.keys.push({
					id: `key_${id()}`,
					label: "Migrated PI_ROUTER_API_KEY",
					digest: digest(seedKey),
					created_at: timestamp,
					updated_at: timestamp,
				});
				await atomicWrite(path, document);
			}
		}
		if (requireKey && document.keys.length === 0) {
			throw new RouterError(
				"No proxy API key is configured. Set PI_ROUTER_API_KEY once to seed the store.",
				{
					status: 500,
					code: "missing_proxy_api_key",
					expose: true,
				},
			);
		}
		return new ProxyKeyStore({ path, document, now, random, id });
	}

	#run(operation) {
		const current = this.mutation;
		let release;
		this.mutation = new Promise((resolve) => {
			release = resolve;
		});
		return current.then(operation).finally(release);
	}

	async #write(document) {
		validateDocument(document);
		await atomicWrite(this.path, document);
		this.document = document;
	}

	count() {
		return this.document.keys.length;
	}

	list() {
		return {
			object: "list",
			data: this.document.keys.map(publicEntry),
		};
	}

	authorize(value) {
		if (typeof value !== "string" || value.length === 0) {
			return false;
		}
		const supplied = Buffer.from(digest(value), "hex");
		let authorized = false;
		for (const entry of this.document.keys) {
			const expected = Buffer.from(entry.digest, "hex");
			authorized = timingSafeEqual(supplied, expected) || authorized;
		}
		return authorized;
	}

	create(input = {}) {
		return this.#run(async () => {
			if (this.document.keys.length >= MAX_KEYS) {
				throw new RouterError("Proxy API-key capacity is full.", {
					status: 409,
					code: "proxy_key_capacity",
					type: "invalid_request_error",
				});
			}
			const value = keyValue(this.random);
			const timestamp = iso(this.now());
			const entry = {
				id: `key_${this.id()}`,
				label: label(input.label),
				digest: digest(value),
				created_at: timestamp,
				updated_at: timestamp,
			};
			await this.#write({
				version: STORE_VERSION,
				keys: [...this.document.keys, entry],
			});
			return {
				object: "pi_router.proxy_api_key",
				status: "created",
				...publicEntry(entry),
				value,
			};
		});
	}

	update(id, input = {}) {
		return this.#run(async () => {
			const index = this.document.keys.findIndex((entry) => entry.id === id);
			if (index < 0) {
				throw new RouterError("Proxy API key was not found.", {
					status: 404,
					code: "proxy_key_not_found",
					type: "invalid_request_error",
				});
			}
			const entry = {
				...this.document.keys[index],
				label: label(input.label),
				updated_at: iso(this.now()),
			};
			const keys = [...this.document.keys];
			keys[index] = entry;
			await this.#write({ version: STORE_VERSION, keys });
			return {
				object: "pi_router.proxy_api_key",
				status: "updated",
				...publicEntry(entry),
			};
		});
	}

	replace(id) {
		return this.#run(async () => {
			const index = this.document.keys.findIndex((entry) => entry.id === id);
			if (index < 0) {
				throw new RouterError("Proxy API key was not found.", {
					status: 404,
					code: "proxy_key_not_found",
					type: "invalid_request_error",
				});
			}
			const value = keyValue(this.random);
			const entry = {
				...this.document.keys[index],
				digest: digest(value),
				updated_at: iso(this.now()),
			};
			const keys = [...this.document.keys];
			keys[index] = entry;
			await this.#write({ version: STORE_VERSION, keys });
			return {
				object: "pi_router.proxy_api_key",
				status: "replaced",
				...publicEntry(entry),
				value,
			};
		});
	}

	remove(id) {
		return this.#run(async () => {
			const index = this.document.keys.findIndex((entry) => entry.id === id);
			if (index < 0) {
				throw new RouterError("Proxy API key was not found.", {
					status: 404,
					code: "proxy_key_not_found",
					type: "invalid_request_error",
				});
			}
			if (this.document.keys.length <= 1) {
				throw new RouterError("The last proxy API key cannot be removed.", {
					status: 409,
					code: "last_proxy_key",
					type: "invalid_request_error",
				});
			}
			const [removed] = this.document.keys.slice(index, index + 1);
			const keys = this.document.keys.filter((entry) => entry.id !== id);
			await this.#write({ version: STORE_VERSION, keys });
			return {
				object: "pi_router.proxy_api_key",
				status: "removed",
				id: removed.id,
			};
		});
	}
}
