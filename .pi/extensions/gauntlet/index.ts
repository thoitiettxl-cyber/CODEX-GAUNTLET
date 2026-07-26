import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	isCoveredBuiltin,
	REPO_ROOT,
	runSharedPolicy,
	translatePiToolCall,
	type PolicyDecision,
} from "./policy.ts";
import { MutationVerification } from "./verification.ts";


interface ContinuityEnvelope {
	hook_event_name: "SessionStart" | "PreCompact" | "PostCompact" | "SessionEnd";
	session_id: string;
	cwd: string;
	source?: "startup" | "resume" | "compact";
	trigger?: "manual" | "auto";
	reason?: string;
	runtime: "pi";
}


interface ContinuityResult {
	protocol_version: 1;
	event: string;
	continue: boolean;
	degraded: boolean;
	message?: string;
}


const PROMPT_APPENDIX = [
	"Pi Gauntlet is defense in depth only, not a sandbox or approval boundary.",
	"Follow the repository AGENTS.md workflow and treat ./qa/verify as the only executable pass/fail authority.",
	"Only Pi's built-in bash, edit, and write calls are covered; custom or extension mutation tools remain outside this adapter.",
	"Non-interactive runs fail closed whenever a policy decision requires human approval.",
].join(" ");
const CONTINUITY_SCRIPT = join(REPO_ROOT, "scripts", "continuity_cli.py");
const MAX_CONTINUITY_OUTPUT = 8_192;
const CONTINUITY_TIMEOUT_MS = 5_000;
const CONTINUITY_PROBE = process.env.PI_GAUNTLET_CONTINUITY_PROBE === "1";
const PROBE_PROVIDER = "pi-gauntlet-continuity-probe";
const PROBE_MODEL = "offline-compaction";


export function appendPiGuidance(
	systemPrompt: string,
	continuityAppendix = "",
): string {
	const suffix = continuityAppendix ? `\n\n${continuityAppendix}` : "";
	return `${systemPrompt}\n\n${PROMPT_APPENDIX}${suffix}`;
}


function pythonCommand(): string {
	const prefix = process.env.PREFIX;
	return prefix ? join(prefix, "bin", "python3") : "python3";
}


function degradedContinuity(event: string): ContinuityResult {
	return {
		protocol_version: 1,
		event,
		continue: true,
		degraded: true,
		message: "Pi continuity bridge is unavailable. Inspect the linked Git plan, Harness work graph, continuity status, and real external targets before a consequential retry.",
	};
}


function validContinuityResult(value: unknown): value is ContinuityResult {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const result = value as Partial<ContinuityResult>;
	return (
		result.protocol_version === 1
		&& typeof result.event === "string"
		&& typeof result.continue === "boolean"
		&& typeof result.degraded === "boolean"
		&& (result.message === undefined || typeof result.message === "string")
	);
}


async function runContinuity(
	envelope: ContinuityEnvelope,
): Promise<ContinuityResult> {
	return await new Promise<ContinuityResult>((resolveResult) => {
		let stdout = "";
		let settled = false;
		const child = spawn(
			pythonCommand(),
			[CONTINUITY_SCRIPT, "--repo-root", REPO_ROOT, "lifecycle"],
			{
				cwd: REPO_ROOT,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);

		const finish = (result: ContinuityResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveResult(result);
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(degradedContinuity(envelope.hook_event_name));
		}, CONTINUITY_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (Buffer.byteLength(stdout, "utf8") > MAX_CONTINUITY_OUTPUT) {
				child.kill();
			}
		});
		child.stderr.on("data", () => {
			// Drain bounded-lifetime diagnostics without exposing runtime details.
		});
		child.on("error", () => finish(degradedContinuity(envelope.hook_event_name)));
		child.on("close", (code) => {
			if (
				settled
				|| code !== 0
				|| Buffer.byteLength(stdout, "utf8") > MAX_CONTINUITY_OUTPUT
			) {
				finish(degradedContinuity(envelope.hook_event_name));
				return;
			}
			try {
				const parsed: unknown = JSON.parse(stdout);
				finish(
					validContinuityResult(parsed)
						? parsed
						: degradedContinuity(envelope.hook_event_name),
				);
			} catch {
				finish(degradedContinuity(envelope.hook_event_name));
			}
		});
		child.stdin.on("error", () => finish(degradedContinuity(envelope.hook_event_name)));
		child.stdin.end(JSON.stringify(envelope));
	});
}


function compactTrigger(reason: "manual" | "threshold" | "overflow"): "manual" | "auto" {
	return reason === "manual" ? "manual" : "auto";
}


class PiContinuity {
	private pendingRecovery = "";

	public constructor(private readonly pi: ExtensionAPI) {}

	private sessionKey(ctx: ExtensionContext): string | null {
		if (!ctx.sessionManager.getSessionFile()) return null;
		const nativeSessionId = ctx.sessionManager.getSessionId();
		return nativeSessionId ? `pi:${nativeSessionId}` : null;
	}

	private envelope(
		ctx: ExtensionContext,
		event: ContinuityEnvelope["hook_event_name"],
		extra: Partial<ContinuityEnvelope> = {},
	): ContinuityEnvelope | null {
		const sessionId = this.sessionKey(ctx);
		if (!sessionId) return null;
		return {
			hook_event_name: event,
			session_id: sessionId,
			cwd: ctx.cwd,
			runtime: "pi",
			...extra,
		};
	}

	private async dispatch(
		ctx: ExtensionContext,
		event: ContinuityEnvelope["hook_event_name"],
		extra: Partial<ContinuityEnvelope> = {},
	): Promise<ContinuityResult | null> {
		const envelope = this.envelope(ctx, event, extra);
		if (!envelope) return null;
		const result = await runContinuity(envelope);
		if (result.degraded && ctx.hasUI) {
			ctx.ui.notify(result.message ?? "Pi continuity recovery degraded.", "warning");
		}
		return result;
	}

	public promptAppendix(ctx: ExtensionContext): string {
		const sessionId = this.sessionKey(ctx);
		if (!sessionId) return "";
		const recovery = this.pendingRecovery;
		this.pendingRecovery = "";
		return [
			`Repository continuity session key: ${sessionId}.`,
			"Record explicit safe boundaries, completed/pending operations, external observations, verification state, and the exact next action with scripts/termux-control continuity checkpoint before consequential work or compaction.",
			recovery,
		].filter(Boolean).join("\n\n");
	}

	public async sessionStart(
		reason: "startup" | "reload" | "new" | "resume" | "fork",
		ctx: ExtensionContext,
	): Promise<void> {
		if (reason === "reload") return;
		const sessionFile = ctx.sessionManager.getSessionFile();
		const persistedStartup = (
			reason === "startup"
			&& Boolean(sessionFile)
			&& existsSync(sessionFile ?? "")
			&& ctx.sessionManager.getEntries().length > 0
		);
		const reopened = (
			reason === "resume"
			|| reason === "fork"
			|| persistedStartup
		);
		const result = await this.dispatch(ctx, "SessionStart", {
			source: reopened ? "resume" : "startup",
		});
		if (result?.message) this.pendingRecovery = result.message;
	}

	public async beforeCompact(
		reason: "manual" | "threshold" | "overflow",
		ctx: ExtensionContext,
	): Promise<void> {
		await this.dispatch(ctx, "PreCompact", { trigger: compactTrigger(reason) });
	}

	public async afterCompact(
		reason: "manual" | "threshold" | "overflow",
		willRetry: boolean,
		ctx: ExtensionContext,
	): Promise<void> {
		const result = await this.dispatch(ctx, "PostCompact", {
			trigger: compactTrigger(reason),
			source: "compact",
		});
		if (!result?.message) return;
		if (willRetry) {
			this.pi.sendMessage(
				{
					customType: "pi-gauntlet-continuity",
					content: result.message,
					display: true,
					details: { source: `PostCompact/${reason}`, degraded: result.degraded },
				},
				{ deliverAs: "steer", triggerTurn: false },
			);
			return;
		}
		this.pendingRecovery = result.message;
	}

	public async shutdown(reason: string, ctx: ExtensionContext): Promise<void> {
		await this.dispatch(ctx, "SessionEnd", { reason });
	}

	public probeState(ctx: ExtensionContext): Record<string, unknown> {
		return {
			protocol_version: 1,
			session_id: this.sessionKey(ctx),
			session_file: ctx.sessionManager.getSessionFile() ?? null,
			pending_recovery: Boolean(this.pendingRecovery),
			recovery_message: this.pendingRecovery,
		};
	}
}


export default function piGauntlet(pi: ExtensionAPI): void {
	const verification = new MutationVerification(pi, REPO_ROOT);
	const continuity = new PiContinuity(pi);
	const pending = new Map<string, PolicyDecision>();

	if (CONTINUITY_PROBE) {
		pi.registerProvider(PROBE_PROVIDER, {
			name: "Pi Gauntlet offline continuity probe",
			baseUrl: "http://127.0.0.1:9/v1",
			apiKey: "probe-only",
			api: "openai-completions",
			models: [{
				id: PROBE_MODEL,
				name: "Offline compaction probe",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 64_000,
				maxTokens: 1_024,
			}],
		});
	}

	pi.on("session_start", async (event, ctx) => {
		await continuity.sessionStart(event.reason, ctx);
		if (CONTINUITY_PROBE) {
			const model = ctx.modelRegistry.find(PROBE_PROVIDER, PROBE_MODEL);
			if (model) await pi.setModel(model);
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		await continuity.beforeCompact(event.reason, ctx);
		if (CONTINUITY_PROBE) {
			return {
				compaction: {
					summary: "Offline Pi continuity lifecycle probe summary.",
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
				},
			};
		}
	});

	pi.on("session_compact", async (event, ctx) => {
		await continuity.afterCompact(event.reason, event.willRetry, ctx);
		if (CONTINUITY_PROBE) {
			console.log(JSON.stringify({
				operation: "pi.continuity-compaction-probe",
				reason: event.reason,
				will_retry: event.willRetry,
				continuity: continuity.probeState(ctx),
			}));
		}
	});

	pi.on("session_shutdown", async (event, ctx) => {
		await continuity.shutdown(event.reason, ctx);
	});

	pi.on("before_agent_start", (event, ctx) => ({
		systemPrompt: appendPiGuidance(
			event.systemPrompt,
			continuity.promptAppendix(ctx),
		),
	}));

	pi.on("input", (event) => {
		if (event.source !== "extension") verification.resetRepairBudget();
	});

	pi.on("tool_call", async (event, ctx) => {
		let translated;
		try {
			translated = translatePiToolCall(event);
		} catch (error) {
			return {
				block: true,
				reason: `Pi Gauntlet rejected malformed covered-tool input: ${String(error)}`.slice(0, 240),
			};
		}
		if (!translated) return;

		const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
		if (!isCoveredBuiltin(event.toolName, tool?.sourceInfo)) {
			return {
				block: true,
				reason: `Pi Gauntlet does not treat overridden or unknown '${event.toolName}' tools as protected built-ins.`,
			};
		}

		const decision = await runSharedPolicy(translated, ctx.cwd);
		if (decision.action === "deny") {
			return { block: true, reason: decision.reason };
		}
		if (decision.action === "requires_human") {
			if (ctx.mode !== "tui") {
				return {
					block: true,
					reason: "Pi Gauntlet requires human approval, but this run is non-interactive.",
				};
			}
			const confirmed = await ctx.ui.confirm(
				"Pi Gauntlet maintenance approval",
				`${decision.reason}\n\nTargets: ${decision.normalized_targets.join(", ")}`,
			);
			if (!confirmed) {
				return { block: true, reason: "Pi Gauntlet maintenance approval was declined." };
			}
		}
		pending.set(event.toolCallId, decision);
	});

	pi.on("tool_result", (event, ctx) => {
		const decision = pending.get(event.toolCallId);
		pending.delete(event.toolCallId);
		if (!decision || event.isError || !decision.mutation) return;
		verification.recordSuccessfulMutation(event.toolName, ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await verification.settle(ctx);
	});

	if (process.env.PI_GAUNTLET_PROBE === "1") {
		pi.registerCommand("gauntlet-probe", {
			description: "Run the offline project Pi Gauntlet probe",
			handler: async (_args, ctx) => {
				const dangerous = await runSharedPolicy(
					{ operation: "shell", text: "git reset --hard HEAD~1", targets: [] },
					ctx.cwd,
				);
				const protectedWrite = await runSharedPolicy(
					{
						operation: "write",
						text: "synthetic",
						targets: [".pi/extensions/gauntlet/index.ts"],
					},
					ctx.cwd,
				);
				const composed = appendPiGuidance("pi-default-prompt");
				console.log(JSON.stringify({
					operation: "pi.gauntlet-probe",
					resource_loaded: true,
					policy: {
						dangerous: dangerous.action,
						protected_write: protectedWrite.action,
					},
					prompt: {
						default_preserved: composed.startsWith("pi-default-prompt"),
						appendix_present: composed.includes("Pi Gauntlet is defense in depth"),
					},
					verification: verification.probeState(),
					continuity: continuity.probeState(ctx),
				}));
			},
		});
	}

	if (CONTINUITY_PROBE) {
		pi.registerCommand("gauntlet-continuity-probe", {
			description: "Exercise or report the offline Pi continuity lifecycle state",
			handler: async (args, ctx) => {
				if (args.trim() === "compact") {
					await new Promise<void>((resolveProbe, rejectProbe) => {
						ctx.compact({
							onComplete: () => resolveProbe(),
							onError: (error) => rejectProbe(error),
						});
					});
				}
				console.log(JSON.stringify({
					operation: "pi.continuity-resume-probe",
					continuity: continuity.probeState(ctx),
				}));
			},
		});
	}
}
