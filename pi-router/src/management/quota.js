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

function normalizeAvailable(provider, result, now) {
	const windows = Array.isArray(result?.windows)
		? result.windows.slice(0, 8).map(normalizeWindow).filter(Boolean)
		: [];
	if (windows.length === 0) {
		throw new Error("Quota adapter returned no valid windows");
	}
	return {
		provider_id: provider.id,
		provider_name: provider.name,
		status: "available",
		capability: "provider_adapter",
		windows,
		checked_at: new Date(now()).toISOString(),
	};
}

export function createQuotaService({ providers, adapters = new Map(), now = Date.now } = {}) {
	if (!providers || typeof providers.list !== "function") {
		throw new TypeError("providers service is required");
	}
	const registry = adapters instanceof Map ? adapters : new Map(Object.entries(adapters));
	return {
		async summary() {
			const providerList = await providers.list();
			return {
				supported_providers: providerList.data
					.filter((provider) => registry.has(provider.id))
					.length,
				total_providers: providerList.data.length,
			};
		},
		async list() {
			const providerList = await providers.list();
			const data = await Promise.all(providerList.data.map(async (provider) => {
				const adapter = registry.get(provider.id);
				if (!adapter || typeof adapter.fetch !== "function") {
					return {
						provider_id: provider.id,
						provider_name: provider.name,
						status: "unsupported",
						capability: "none",
						windows: [],
					};
				}
				try {
					return normalizeAvailable(
						provider,
						await adapter.fetch({ provider_id: provider.id }),
						now,
					);
				} catch {
					return {
						provider_id: provider.id,
						provider_name: provider.name,
						status: "error",
						capability: "provider_adapter",
						error_code: "quota_unavailable",
						windows: [],
					};
				}
			}));
			return {
				object: "list",
				data,
			};
		},
	};
}
