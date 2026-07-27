import {
	bearerToken,
	number,
	requestJson,
	resetsAt,
} from "./request.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const WINDOWS = [
	["five_hour", "Claude 5 hour"],
	["seven_day", "Claude 7 day"],
	["seven_day_oauth_apps", "Claude OAuth apps 7 day"],
	["seven_day_opus", "Claude Opus 7 day"],
	["seven_day_sonnet", "Claude Sonnet 7 day"],
	["seven_day_cowork", "Claude Cowork 7 day"],
	["iguana_necktie", "Claude additional window"],
];

export function createClaudeQuotaAdapter({ fetchImpl = fetch, now = Date.now } = {}) {
	return {
		async fetch({ credential }) {
			const token = bearerToken(await credential.resolveAuth());
			const payload = await requestJson({
				url: USAGE_URL,
				token,
				fetchImpl,
				headers: {
					"content-type": "application/json",
					"anthropic-beta": "oauth-2025-04-20",
				},
			});
			const windows = WINDOWS.map(([key, label]) => {
				const source = payload[key];
				let used = number(source?.utilization ?? source?.used_percent ?? source?.usedPercent);
				if (used === undefined) {
					return undefined;
				}
				if (used >= 0 && used <= 1) {
					used *= 100;
				}
				return {
					label,
					unit: "percent",
					used: Math.max(0, Math.min(100, used)),
					limit: 100,
					resets_at: resetsAt(
						source?.resets_at ?? source?.resetsAt ?? source?.reset_at,
						now,
					),
				};
			}).filter(Boolean);
			const extra = payload.extra_usage;
			const extraUsed = number(extra?.used_credits);
			const extraLimit = number(extra?.monthly_limit);
			if (extra?.is_enabled && extraUsed !== undefined && extraLimit !== undefined) {
				windows.push({
					label: "Claude extra usage",
					unit: "cents",
					used: Math.max(0, extraUsed),
					limit: Math.max(0, extraLimit),
				});
			}
			return { windows };
		},
	};
}
