import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	open,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { RouterError, invalidRequest } from "../errors.js";
import { MAX_CONFIG_BYTES, validateConfigDocument } from "./config-policy.js";
import { conflict, exactKeys, requireRecord } from "./validation.js";

const MAX_CONFIG_CHANGES = 200;

function revision(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function serialized(document) {
	return `${JSON.stringify(document, null, 2)}\n`;
}

function displayValue(value) {
	if (value === undefined) {
		return null;
	}
	const text = JSON.stringify(value);
	return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function plainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configDiff(before, after, path = "root", changes = []) {
	if (changes.length > MAX_CONFIG_CHANGES || Object.is(before, after)) {
		return changes;
	}
	const beforeArray = Array.isArray(before);
	const afterArray = Array.isArray(after);
	if (
		(beforeArray || before === undefined)
		&& (afterArray || after === undefined)
		&& (beforeArray || afterArray)
	) {
		const beforeItems = beforeArray ? before : [];
		const afterItems = afterArray ? after : [];
		const length = Math.max(beforeItems.length, afterItems.length);
		if (length === 0) {
			changes.push({
				path,
				before: displayValue(before),
				after: displayValue(after),
			});
			return changes;
		}
		for (let index = 0; index < length; index += 1) {
			configDiff(beforeItems[index], afterItems[index], `${path}.${index}`, changes);
			if (changes.length > MAX_CONFIG_CHANGES) {
				break;
			}
		}
		return changes;
	}
	const beforeRecord = plainObject(before);
	const afterRecord = plainObject(after);
	if (
		(beforeRecord || before === undefined)
		&& (afterRecord || after === undefined)
		&& (beforeRecord || afterRecord)
	) {
		const beforeValue = beforeRecord ? before : {};
		const afterValue = afterRecord ? after : {};
		const keys = [...new Set([
			...Object.keys(beforeValue),
			...Object.keys(afterValue),
		])].sort();
		if (keys.length === 0) {
			changes.push({
				path,
				before: displayValue(before),
				after: displayValue(after),
			});
			return changes;
		}
		for (const key of keys) {
			configDiff(beforeValue[key], afterValue[key], `${path}.${key}`, changes);
			if (changes.length > MAX_CONFIG_CHANGES) {
				break;
			}
		}
		return changes;
	}
	if (JSON.stringify(before) !== JSON.stringify(after)) {
		changes.push({
			path,
			before: displayValue(before),
			after: displayValue(after),
		});
	}
	return changes;
}

function reviewedDiff(before, after) {
	const found = configDiff(before, after);
	return {
		changes: found.slice(0, MAX_CONFIG_CHANGES),
		truncated: found.length > MAX_CONFIG_CHANGES,
	};
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

async function atomicWrite(path, content) {
	const directory = dirname(path);
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(content, "utf8");
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

async function readBounded(path, { missing = false } = {}) {
	let metadata;
	try {
		metadata = await stat(path);
	} catch (error) {
		if (missing && error?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
		return {
			valid: false,
			errors: [{
				path: "root",
				message: metadata.isFile()
					? `Document exceeds ${MAX_CONFIG_BYTES} bytes.`
					: "Configuration target is not a regular file.",
			}],
			bytes: Buffer.alloc(0),
			revision: null,
		};
	}
	let bytes;
	let handle;
	try {
		handle = await open(path, "r");
		const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
		let total = 0;
		while (total < buffer.length) {
			const result = await handle.read(buffer, total, buffer.length - total, total);
			if (result.bytesRead === 0) {
				break;
			}
			total += result.bytesRead;
		}
		bytes = buffer.subarray(0, total);
	} catch (error) {
		if (missing && error?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	} finally {
		await handle?.close();
	}
	if (bytes.length > MAX_CONFIG_BYTES) {
		return {
			valid: false,
			errors: [{ path: "root", message: `Document exceeds ${MAX_CONFIG_BYTES} bytes.` }],
			bytes,
			revision: revision(bytes),
		};
	}
	let document;
	try {
		document = JSON.parse(bytes.toString("utf8"));
	} catch {
		return {
			valid: false,
			errors: [{ path: "root", message: "Current configuration is not valid JSON." }],
			bytes,
			revision: revision(bytes),
		};
	}
	const validation = validateConfigDocument(document);
	return {
		...validation,
		bytes,
		revision: revision(bytes),
		serialized: validation.valid ? serialized(validation.document) : undefined,
	};
}

export class ConfigService {
	constructor({ modelsPath, runtime } = {}) {
		this.modelsPath = modelsPath;
		this.recoveryPath = modelsPath ? `${modelsPath}.previous` : undefined;
		this.runtime = runtime;
		this.active = false;
	}

	async #current() {
		if (!this.modelsPath) {
			return undefined;
		}
		const found = await readBounded(this.modelsPath, { missing: true });
		if (found) {
			return { ...found, exists: true };
		}
		const document = { providers: {} };
		const bytes = Buffer.alloc(0);
		return {
			...validateConfigDocument(document),
			bytes,
			revision: revision(bytes),
			serialized: serialized(document),
			exists: false,
		};
	}

	async #recovery() {
		return this.recoveryPath
			? readBounded(this.recoveryPath, { missing: true })
			: undefined;
	}

	async #activate() {
		if (!this.runtime || typeof this.runtime.refreshConfiguration !== "function") {
			return { activation: "restart_required", restart_required: true };
		}
		try {
			await this.runtime.refreshConfiguration();
			return { activation: "reloaded", restart_required: false };
		} catch {
			return { activation: "restart_required", restart_required: true };
		}
	}

	async get() {
		if (!this.modelsPath) {
			return {
				object: "pi_router.config",
				supported: false,
				editable: false,
				reason: "configuration_path_unavailable",
				revision: null,
				document: null,
				errors: [],
				recovery_available: false,
			};
		}
		const [current, recovery] = await Promise.all([this.#current(), this.#recovery()]);
		return {
			object: "pi_router.config",
			supported: true,
			editable: current.valid,
			reason: current.valid ? null : "configuration_not_editable",
			revision: current.revision,
			document: current.valid ? current.document : null,
			errors: current.errors,
			recovery_available: recovery?.valid === true,
		};
	}

	async summary() {
		const result = await this.get();
		return {
			supported: result.supported,
			editable: result.editable,
			recovery_available: result.recovery_available,
			state: !result.supported
				? "unsupported"
				: (result.editable ? "ready" : "invalid"),
		};
	}

	async preview(input) {
		const body = requireRecord(input);
		exactKeys(body, new Set(["document"]));
		const [current, candidate] = await Promise.all([
			this.#current(),
			Promise.resolve(validateConfigDocument(body.document)),
		]);
		if (!current) {
			return {
				object: "pi_router.config_preview",
				valid: false,
				revision: null,
				errors: [{ path: "root", message: "Configuration editing is unsupported." }],
				changed: false,
				changes: [],
			};
		}
		if (!current.valid) {
			return {
				object: "pi_router.config_preview",
				valid: false,
				revision: current.revision,
				errors: current.errors,
				changed: false,
				changes: [],
			};
		}
		if (!candidate.valid) {
			return {
				object: "pi_router.config_preview",
				valid: false,
				revision: current.revision,
				errors: candidate.errors,
				changed: false,
				changes: [],
			};
		}
		const diff = reviewedDiff(current.document, candidate.document);
		if (diff.truncated) {
			return {
				object: "pi_router.config_preview",
				valid: false,
				revision: current.revision,
				errors: [{
					path: "root",
					message: `Draft exceeds the ${MAX_CONFIG_CHANGES}-change review limit.`,
				}],
				changed: true,
				changes: [],
			};
		}
		return {
			object: "pi_router.config_preview",
			valid: true,
			revision: current.revision,
			errors: [],
			changed: diff.changes.length > 0,
			changes: diff.changes,
		};
	}

	async #mutate(operation) {
		if (this.active) {
			throw conflict("A configuration mutation is already active.", "config_mutation_in_progress");
		}
		this.active = true;
		try {
			return await operation();
		} finally {
			this.active = false;
		}
	}

	async apply(input) {
		const body = requireRecord(input);
		exactKeys(body, new Set(["document", "expected_revision"]));
		if (!/^[a-f0-9]{64}$/u.test(body.expected_revision ?? "")) {
			throw invalidRequest("expected_revision is invalid.", "invalid_config_revision");
		}
		return this.#mutate(async () => {
			const current = await this.#current();
			if (!current) {
				throw new RouterError("Configuration editing is unsupported.", {
					status: 501,
					code: "config_unsupported",
					type: "invalid_request_error",
				});
			}
			if (!current.valid) {
				throw conflict("Current configuration is not editable.", "config_not_editable");
			}
			if (current.revision !== body.expected_revision) {
				throw conflict("Configuration changed after preview.", "config_revision_conflict");
			}
			const candidate = validateConfigDocument(body.document);
			if (!candidate.valid) {
				throw invalidRequest(
					"Configuration failed validation. Preview the document for details.",
					"invalid_configuration",
				);
			}
			const diff = reviewedDiff(current.document, candidate.document);
			if (diff.truncated) {
				throw invalidRequest(
					`Configuration exceeds the ${MAX_CONFIG_CHANGES}-change review limit.`,
					"config_diff_too_large",
				);
			}
			if (diff.changes.length === 0) {
				return {
					object: "pi_router.config_mutation",
					status: "unchanged",
					revision: current.revision,
					activation: "unchanged",
					restart_required: false,
					recovery_available: (await this.#recovery())?.valid === true,
					changes: [],
				};
			}
			if (current.exists) {
				await atomicWrite(this.recoveryPath, current.serialized);
			}
			const next = serialized(candidate.document);
			await atomicWrite(this.modelsPath, next);
			const activation = await this.#activate();
			return {
				object: "pi_router.config_mutation",
				status: "applied",
				revision: revision(Buffer.from(next)),
				...activation,
				recovery_available: current.exists || (await this.#recovery())?.valid === true,
				changes: diff.changes,
			};
		});
	}

	async restore(input) {
		const body = requireRecord(input);
		exactKeys(body, new Set(["expected_revision"]));
		if (!/^[a-f0-9]{64}$/u.test(body.expected_revision ?? "")) {
			throw invalidRequest("expected_revision is invalid.", "invalid_config_revision");
		}
		return this.#mutate(async () => {
			const [current, recovery] = await Promise.all([this.#current(), this.#recovery()]);
			if (!current || !current.valid) {
				throw conflict("Current configuration is not editable.", "config_not_editable");
			}
			if (current.revision !== body.expected_revision) {
				throw conflict("Configuration changed after it was loaded.", "config_revision_conflict");
			}
			if (!recovery?.valid) {
				throw conflict("No validated recovery configuration is available.", "config_recovery_unavailable");
			}
			const diff = reviewedDiff(current.document, recovery.document);
			await atomicWrite(this.modelsPath, recovery.serialized);
			await atomicWrite(this.recoveryPath, current.serialized);
			const activation = await this.#activate();
			return {
				object: "pi_router.config_mutation",
				status: "restored",
				revision: revision(Buffer.from(recovery.serialized)),
				...activation,
				recovery_available: true,
				changes: diff.changes,
				changes_truncated: diff.truncated,
			};
		});
	}
}
