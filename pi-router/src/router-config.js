import { randomUUID } from "node:crypto";
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

import { parseDocument, stringify } from "yaml";

import { RouterError } from "./errors.js";
import { readProviderPolicy } from "./provider-policy.js";
import {
	mergeConfigDocument,
	splitConfigDocument,
	validateConfigDocument,
} from "./management/config-policy.js";
import { isRecord } from "./management/validation.js";

export const MAX_ROUTER_CONFIG_BYTES = 512 * 1024;
export const LOOPBACK_CONFIG_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function issue(path, message) {
	return { path, message };
}

function invalidConfiguration(errors, code = "router_config_invalid") {
	const selected = errors[0] ?? issue("root", "Configuration is invalid.");
	return new RouterError(`${selected.path}: ${selected.message}`, {
		status: 422,
		code,
		type: "invalid_request_error",
	});
}

function invalidYaml(message = "Configuration must be valid YAML.") {
	return new RouterError(message, {
		status: 400,
		code: "invalid_yaml",
		type: "invalid_request_error",
	});
}

function clone(value) {
	return structuredClone(value);
}

export function validateRouterConfig(value) {
	const errors = [];
	const add = (path, message) => {
		if (errors.length < 64) {
			errors.push(issue(path, message));
		}
	};
	if (!isRecord(value)) {
		return {
			valid: false,
			errors: [issue("root", "Configuration must be a YAML mapping.")],
		};
	}
	const host = value.host;
	if (typeof host !== "string" || host.trim().length === 0 || host.length > 255) {
		add("host", "Must be a non-empty string of at most 255 characters.");
	}
	if (!Number.isSafeInteger(value.port) || value.port < 0 || value.port > 65535) {
		add("port", "Must be an integer from 0 to 65535.");
	}
	const remote = value["remote-management"];
	if (!isRecord(remote)) {
		add("remote-management", "Must be a mapping.");
	} else {
		if (typeof remote["allow-remote"] !== "boolean") {
			add("remote-management.allow-remote", "Must be a boolean.");
		}
		if (
			typeof remote["secret-key"] !== "string"
			|| remote["secret-key"].length > 8192
		) {
			add("remote-management.secret-key", "Must be a string of at most 8192 characters.");
		}
		if (
			remote["allow-remote"] === false
			&& typeof host === "string"
			&& !LOOPBACK_CONFIG_HOSTS.has(host)
		) {
			add(
				"host",
				"Must be loopback unless remote-management.allow-remote is true.",
			);
		}
	}
	if (typeof value["request-logging"] !== "boolean") {
		add("request-logging", "Must be a boolean.");
	}
	if (!isRecord(value.environment)) {
		add("environment", "Must be a mapping of environment names to string values.");
	} else {
		for (const [name, entry] of Object.entries(value.environment)) {
			if (
				!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name)
				|| typeof entry !== "string"
				|| entry.length > 8192
			) {
				add(
					`environment.${name}`,
					"Environment names must be valid and values must be strings of at most 8192 characters.",
				);
			}
		}
	}
	if (
		isRecord(remote)
		&& typeof remote["secret-key"] === "string"
		&& remote["secret-key"].length > 0
		&& isRecord(value.environment)
		&& value.environment.PI_ROUTER_API_KEY === remote["secret-key"]
	) {
		add(
			"environment.PI_ROUTER_API_KEY",
			"Must differ from remote-management.secret-key.",
		);
	}
	const providers = validateConfigDocument({ providers: value.providers });
	if (!providers.valid) {
		errors.push(...providers.errors.slice(0, Math.max(0, 64 - errors.length)));
	}
	return errors.length > 0
		? { valid: false, errors }
		: { valid: true, errors: [], document: clone(value) };
}

export function parseRouterConfig(source) {
	const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? "");
	if (bytes.length > MAX_ROUTER_CONFIG_BYTES) {
		throw new RouterError(
			`Configuration exceeds ${MAX_ROUTER_CONFIG_BYTES} bytes.`,
			{
				status: 413,
				code: "request_too_large",
				type: "invalid_request_error",
			},
		);
	}
	let parsed;
	try {
		const document = parseDocument(bytes.toString("utf8"), {
			prettyErrors: false,
			uniqueKeys: true,
		});
		const problem = document.errors[0];
		if (problem) {
			const [line, column] = problem.linePos?.[0] ?? [];
			const location = line && column ? ` at line ${line}, column ${column}` : "";
			throw invalidYaml(`Configuration YAML is invalid${location}: ${problem.message}`);
		}
		parsed = document.toJS({ maxAliasCount: 100 });
	} catch (error) {
		if (error instanceof RouterError) {
			throw error;
		}
		throw invalidYaml();
	}
	const validation = validateRouterConfig(parsed);
	if (!validation.valid) {
		throw invalidConfiguration(validation.errors);
	}
	return validation.document;
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

export async function atomicWriteFile(path, content, {
	mode = 0o600,
	encoding,
} = {}) {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", mode);
		await handle.writeFile(content, encoding ? { encoding } : undefined);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
		await chmod(path, mode);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

async function boundedFile(path, {
	missing = false,
	maxBytes = MAX_ROUTER_CONFIG_BYTES,
} = {}) {
	let metadata;
	try {
		metadata = await stat(path);
	} catch (error) {
		if (missing && error?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.size > maxBytes) {
		throw invalidConfiguration([
			issue("root", metadata.isFile()
				? `Configuration exceeds ${maxBytes} bytes.`
				: "Configuration target is not a regular file."),
		]);
	}
	const bytes = await readFile(path);
	if (bytes.length > maxBytes) {
		throw invalidConfiguration([issue("root", `Configuration exceeds ${maxBytes} bytes.`)]);
	}
	return bytes;
}

async function readModels(path) {
	const bytes = await boundedFile(path, { missing: true, maxBytes: 128 * 1024 });
	if (!bytes) {
		return { providers: {} };
	}
	try {
		const value = JSON.parse(bytes.toString("utf8"));
		return isRecord(value) ? value : { providers: {} };
	} catch {
		throw invalidConfiguration([issue("providers", "Existing models.json is invalid.")]);
	}
}

export function defaultRouterConfig({
	host = "127.0.0.1",
	port = 8318,
	managementKey = "",
	requestLogging = true,
	environment = {},
	providers = {},
} = {}) {
	return {
		host,
		port,
		"remote-management": {
			"allow-remote": false,
			"secret-key": managementKey,
		},
		"request-logging": requestLogging,
		environment: clone(environment),
		providers: clone(providers),
	};
}

export async function compileRouterConfig({
	document,
	modelsPath,
	providerPolicyPath,
} = {}) {
	const validation = validateRouterConfig(document);
	if (!validation.valid) {
		throw invalidConfiguration(validation.errors);
	}
	const split = splitConfigDocument({ providers: validation.document.providers });
	await atomicWriteFile(
		providerPolicyPath,
		`${JSON.stringify(split.policy, null, 2)}\n`,
		{ encoding: "utf8" },
	);
	await atomicWriteFile(
		modelsPath,
		`${JSON.stringify(split.models, null, 2)}\n`,
		{ encoding: "utf8" },
	);
	return split;
}

export async function ensureRouterConfig({
	configPath,
	modelsPath,
	providerPolicyPath,
	defaults = {},
} = {}) {
	const existing = await boundedFile(configPath, { missing: true });
	if (existing) {
		const document = parseRouterConfig(existing);
		await compileRouterConfig({ document, modelsPath, providerPolicyPath });
		return { source: existing.toString("utf8"), document, created: false };
	}
	const [models, policy] = await Promise.all([
		readModels(modelsPath),
		readProviderPolicy(providerPolicyPath),
	]);
	const combined = mergeConfigDocument(models, policy);
	const document = defaultRouterConfig({
		...defaults,
		providers: combined.providers ?? {},
	});
	const source = stringify(document, { indent: 2, lineWidth: 100 });
	parseRouterConfig(source);
	await atomicWriteFile(configPath, source, { encoding: "utf8" });
	await compileRouterConfig({ document, modelsPath, providerPolicyPath });
	return { source, document, created: true };
}

export async function readRouterConfig(configPath) {
	const bytes = await boundedFile(configPath);
	return {
		source: bytes.toString("utf8"),
		document: parseRouterConfig(bytes),
	};
}

export function configuredManagementKey(document, fallback) {
	const configured = document?.["remote-management"]?.["secret-key"];
	return typeof configured === "string" && configured.length > 0
		? configured
		: fallback;
}

export function configuredEnvironment(document, ambient = {}) {
	return {
		...ambient,
		...(isRecord(document?.environment) ? document.environment : {}),
	};
}
