import {
	bearerToken,
	number,
	requestJson,
	resetsAt,
} from "./request.js";

const USAGE_URL = "https://api.kimi.com/coding/v1/usages";

function usageWindow(source, label, now) {
	const limit = number(source?.limit);
	let used = number(source?.used);
	const remaining = number(source?.remaining);
	if (used === undefined && limit !== undefined && remaining !== undefined) {
		used = limit - remaining;
	}
	if (used === undefined || limit === undefined) {
		return undefined;
	}
	return {
		label: source?.name ?? source?.title ?? label,
		unit: "requests",
		used: Math.max(0, used),
		limit: Math.max(0, limit),
		resets_at: resetsAt(
			source?.reset_at
				?? source?.resetAt
				?? source?.reset_time
				?? source?.resetTime
				?? source?.reset_in
				?? source?.resetIn
				?? source?.ttl,
			now,
		),
	};
}

export function createKimiQuotaAdapter({ fetchImpl = fetch, now = Date.now } = {}) {
	return {
		async fetch({ credential }) {
			const token = bearerToken(await credential.resolveAuth());
			const payload = await requestJson({ url: USAGE_URL, token, fetchImpl });
			const windows = [];
			for (const [index, limit] of (payload.limits ?? []).entries()) {
				const source = limit?.detail ?? limit;
				const found = usageWindow(source, `Kimi limit ${index + 1}`, now);
				if (found) {
					windows.push(found);
				}
			}
			const summary = usageWindow(payload.usage, "Kimi weekly", now);
			if (summary) {
				windows.push(summary);
			}
			return { windows };
		},
	};
}
