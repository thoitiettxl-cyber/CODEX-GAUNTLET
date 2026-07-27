import {
	bearerToken,
	number,
	requestJson,
	resetsAt,
} from "./request.js";

const WEEKLY_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const HEADERS = {
	"x-xai-token-auth": "xai-grok-cli",
	"x-grok-client-version": "0.2.91",
	"user-agent": "pi-router",
};

function centValue(value) {
	return number(value && typeof value === "object" ? value.val : value);
}

function billingWindows(payload, fallbackLabel, now) {
	const config = payload?.config;
	if (!config || typeof config !== "object") {
		return [];
	}
	const period = config.currentPeriod ?? config.current_period;
	const reset = resetsAt(
		period?.end ?? config.billingPeriodEnd ?? config.billing_period_end,
		now,
	);
	const windows = [];
	const usedPercent = number(config.creditUsagePercent ?? config.credit_usage_percent);
	if (usedPercent !== undefined) {
		windows.push({
			label: period?.type ?? fallbackLabel,
			unit: "percent",
			used: Math.max(0, Math.min(100, usedPercent)),
			limit: 100,
			resets_at: reset,
		});
	}
	for (const [index, product] of (
		config.productUsage
			?? config.product_usage
			?? []
	).entries()) {
		const used = number(product?.usagePercent ?? product?.usage_percent);
		if (used !== undefined) {
			windows.push({
				label: product?.product ?? `xAI product ${index + 1}`,
				unit: "percent",
				used: Math.max(0, Math.min(100, used)),
				limit: 100,
				resets_at: reset,
			});
		}
	}
	const limit = centValue(config.monthlyLimit ?? config.monthly_limit);
	const used = centValue(config.used);
	if (limit !== undefined && used !== undefined) {
		windows.push({
			label: "xAI monthly included usage",
			unit: "cents",
			used: Math.max(0, Math.min(used, limit)),
			limit: Math.max(0, limit),
			resets_at: resetsAt(
				config.billingPeriodEnd ?? config.billing_period_end,
				now,
			),
		});
	}
	return windows;
}

export function createXaiQuotaAdapter({ fetchImpl = fetch, now = Date.now } = {}) {
	return {
		async fetch({ credential }) {
			const token = bearerToken(await credential.resolveAuth());
			const settled = await Promise.allSettled([
				requestJson({ url: WEEKLY_URL, token, headers: HEADERS, fetchImpl }),
				requestJson({ url: MONTHLY_URL, token, headers: HEADERS, fetchImpl }),
			]);
			const windows = [];
			for (const [index, result] of settled.entries()) {
				if (result.status === "fulfilled") {
					windows.push(...billingWindows(
						result.value,
						index === 0 ? "xAI weekly" : "xAI monthly",
						now,
					));
				}
			}
			if (windows.length === 0) {
				throw new Error("xAI quota is unavailable");
			}
			return { windows };
		},
	};
}
