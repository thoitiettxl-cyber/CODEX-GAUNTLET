import {
	bearerToken,
	jwtClaims,
	number,
	requestJson,
	resetsAt,
} from "./request.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function windowValue(value, label, now) {
	const used = number(value?.used_percent ?? value?.usedPercent);
	if (used === undefined) {
		return undefined;
	}
	return {
		label,
		unit: "percent",
		used: Math.max(0, Math.min(100, used)),
		limit: 100,
		resets_at: resetsAt(
			value?.reset_at
				?? value?.resetAt
				?? value?.reset_after_seconds
				?? value?.resetAfterSeconds,
			now,
		),
	};
}

export function createCodexQuotaAdapter({ fetchImpl = fetch, now = Date.now } = {}) {
	return {
		async fetch({ credential }) {
			const token = bearerToken(await credential.resolveAuth());
			const claims = jwtClaims(token);
			const accountId = credential.quota_metadata?.account_id
				?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
			const payload = await requestJson({
				url: USAGE_URL,
				token,
				fetchImpl,
				headers: {
					"content-type": "application/json",
					"user-agent": "pi-router",
					...(accountId ? { "chatgpt-account-id": accountId } : {}),
				},
			});
			const limits = [
				["Codex 5 hour", payload.rate_limit?.primary_window ?? payload.rateLimit?.primaryWindow],
				["Codex weekly", payload.rate_limit?.secondary_window ?? payload.rateLimit?.secondaryWindow],
				[
					"Code review 5 hour",
					payload.code_review_rate_limit?.primary_window
						?? payload.codeReviewRateLimit?.primaryWindow,
				],
				[
					"Code review weekly",
					payload.code_review_rate_limit?.secondary_window
						?? payload.codeReviewRateLimit?.secondaryWindow,
				],
			];
			const windows = limits
				.map(([label, value]) => windowValue(value, label, now))
				.filter(Boolean);
			for (const [index, entry] of (
				payload.additional_rate_limits
				?? payload.additionalRateLimits
				?? []
			).entries()) {
				const info = entry?.rate_limit ?? entry?.rateLimit ?? entry;
				for (const [suffix, value] of [
					["5 hour", info?.primary_window ?? info?.primaryWindow],
					["weekly", info?.secondary_window ?? info?.secondaryWindow],
				]) {
					const found = windowValue(
						value,
						`${entry?.limit_name ?? entry?.limitName ?? `Additional ${index + 1}`} ${suffix}`,
						now,
					);
					if (found) {
						windows.push(found);
					}
				}
			}
			return { windows };
		},
	};
}
