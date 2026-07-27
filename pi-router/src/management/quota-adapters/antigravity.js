import {
	bearerToken,
	number,
	requestJson,
} from "./request.js";

const QUOTA_URLS = [
	"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
];

function quotaWindows(payload) {
	const windows = [];
	for (const [groupIndex, group] of (payload?.groups ?? []).entries()) {
		const groupName = group?.displayName ?? group?.display_name ?? `Antigravity group ${groupIndex + 1}`;
		for (const [bucketIndex, bucket] of (group?.buckets ?? []).entries()) {
			let remaining = number(bucket?.remainingFraction ?? bucket?.remaining_fraction);
			if (remaining === undefined && typeof bucket?.remainingFraction === "string") {
				const percentage = number(bucket.remainingFraction.replace(/%$/u, ""));
				remaining = percentage === undefined ? undefined : percentage / 100;
			}
			if (remaining === undefined) {
				continue;
			}
			if (remaining > 1) {
				remaining /= 100;
			}
			windows.push({
				label: bucket?.displayName
					?? bucket?.display_name
					?? `${groupName} ${bucket?.window ?? bucketIndex + 1}`,
				unit: "percent",
				used: Math.max(0, Math.min(100, (1 - remaining) * 100)),
				limit: 100,
				resets_at: bucket?.resetTime ?? bucket?.reset_time,
			});
		}
	}
	return windows;
}

export function createAntigravityQuotaAdapter({ fetchImpl = fetch } = {}) {
	return {
		async fetch({ credential }) {
			const projectId = credential.quota_metadata?.project_id;
			if (!projectId) {
				throw new Error("Antigravity project id is unavailable");
			}
			const token = bearerToken(await credential.resolveAuth());
			let lastError;
			for (const url of QUOTA_URLS) {
				try {
					const payload = await requestJson({
						url,
						token,
						method: "POST",
						fetchImpl,
						headers: {
							"content-type": "application/json",
							"user-agent": "pi-router",
						},
						body: JSON.stringify({ project: projectId }),
					});
					const windows = quotaWindows(payload);
					if (windows.length > 0) {
						return { windows };
					}
				} catch (error) {
					lastError = error;
				}
			}
			throw lastError ?? new Error("Antigravity quota is unavailable");
		},
	};
}
