// Provider quota APIs are opt-in. Add an adapter here only after its credential
// use, endpoint, response bounds, and normalization contract are reviewed.
import { createAntigravityQuotaAdapter } from "./antigravity.js";
import { createClaudeQuotaAdapter } from "./claude.js";
import { createCodexQuotaAdapter } from "./codex.js";
import { createKimiQuotaAdapter } from "./kimi.js";
import { createXaiQuotaAdapter } from "./xai.js";

export function createDefaultQuotaAdapters(options = {}) {
	return new Map([
		["openai-codex", createCodexQuotaAdapter(options)],
		["anthropic", createClaudeQuotaAdapter(options)],
		["antigravity", createAntigravityQuotaAdapter(options)],
		["kimi-coding", createKimiQuotaAdapter(options)],
		["xai", createXaiQuotaAdapter(options)],
	]);
}

export const defaultQuotaAdapters = createDefaultQuotaAdapters();
