import { safeText } from "./validation.js";

function normalizedNumber(value) {
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeWindow(window, index) {
	const used = normalizedNumber(window?.used);
	const limit = normalizedNumber(window?.limit);
	if (used === undefined || limit === undefined) {
		return undefined;
	}
	let resetsAt;
	if (typeof window.resets_at === "string" && window.resets_at.length <= 64) {
		const timestamp = Date.parse(window.resets_at);
		if (Number.isFinite(timestamp)) {
			resetsAt = new Date(timestamp).toISOString();
		}
	}
	return {
		label: safeText(window?.label, 80, `Window ${index + 1}`),
		unit: safeText(window?.unit, 32, "units"),
		used,
		limit,
		remaining: Math.max(0, limit - used),
		resets_at: resetsAt ?? null,
	};
}

function identity(provider, credential) {
	return {
		credential_id: credential.id,
		credential_label: credential.label,
		account_id: credential.account_id,
		account_label: credential.account_label,
		active: credential.active === true,
		provider_id: provider.id,
		provider_name: provider.name,
		credential_type: credential.type,
	};
}

function normalizeAvailable(provider, credential, result, now) {
	const windows = Array.isArray(result?.windows)
		? result.windows.slice(0, 16).map(normalizeWindow).filter(Boolean)
		: [];
	if (windows.length === 0) {
		throw new Error("Quota adapter returned no valid windows");
	}
	return {
		...identity(provider, credential),
		status: "available",
		capability: "credential_adapter",
		windows,
		checked_at: new Date(now()).toISOString(),
	};
}

async function mapLimit(items, limit, operation) {
	const results = new Array(items.length);
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			for (;;) {
				const index = next;
				next += 1;
				if (index >= items.length) {
					return;
				}
				results[index] = await operation(items[index], index);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

export function createQuotaService({
	providers,
	credentials,
	runtime,
	adapters = new Map(),
	now = Date.now,
} = {}) {
	if (!providers || typeof providers.list !== "function") {
		throw new TypeError("providers service is required");
	}
	if (!credentials || typeof credentials.list !== "function") {
		throw new TypeError("credentials service is required");
	}
	const registry = adapters instanceof Map ? adapters : new Map(Object.entries(adapters));

	async function contexts() {
		if (typeof runtime?.quotaCredentialContexts === "function") {
			return runtime.quotaCredentialContexts();
		}
		return (await credentials.list()).data;
	}

	return {
		async summary() {
			const [providerList, credentialList] = await Promise.all([
				providers.list(),
				credentials.list(),
			]);
			return {
				supported_providers: providerList.data
					.filter((provider) => registry.has(provider.id))
					.length,
				total_providers: providerList.data.length,
				supported_credentials: credentialList.data
					.filter((credential) =>
						credential.type === "oauth" && registry.has(credential.provider_id))
					.length,
				total_credentials: credentialList.data.length,
			};
		},
		async list() {
			const [providerList, credentialList] = await Promise.all([
				providers.list(),
				contexts(),
			]);
			const byId = new Map(providerList.data.map((provider) => [provider.id, provider]));
			const data = await mapLimit(credentialList.slice(0, 256), 4, async (credential) => {
				const provider = byId.get(credential.provider_id) ?? {
					id: credential.provider_id,
					name: credential.provider_name ?? credential.provider_id,
				};
				const adapter = registry.get(provider.id);
				if (
					credential.type !== "oauth"
					|| !adapter
					|| typeof adapter.fetch !== "function"
					|| typeof credential.resolveAuth !== "function"
				) {
					return {
						...identity(provider, credential),
						status: "unsupported",
						capability: "none",
						windows: [],
					};
				}
				try {
					return normalizeAvailable(
						provider,
						credential,
						await adapter.fetch({ credential }),
						now,
					);
				} catch {
					return {
						...identity(provider, credential),
						status: "error",
						capability: "credential_adapter",
						error_code: "quota_unavailable",
						windows: [],
					};
				}
			});
			return {
				object: "list",
				data,
			};
		},
	};
}
