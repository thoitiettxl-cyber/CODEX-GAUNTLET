import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";


export type PolicyAction = "allow" | "deny" | "requires_human";

export interface SharedPolicyInput {
	operation: "shell" | "edit" | "write";
	text: string;
	targets: string[];
}

export interface PolicyDecision {
	action: PolicyAction;
	reason_code: string;
	reason: string;
	normalized_targets: string[];
	protected_targets: string[];
	mutation: boolean;
	policy_sensitive: boolean;
	covered: boolean;
}

interface ToolCallLike {
	toolName: string;
	input: unknown;
}

interface ToolSourceLike {
	source?: string;
}

const EXTENSION_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(EXTENSION_ROOT, "../../..");
const POLICY_SCRIPT = join(REPO_ROOT, "scripts", "gauntlet_policy.py");
const MAX_POLICY_OUTPUT = 16_384;
const POLICY_TIMEOUT_MS = 5_000;
const COVERED_TOOLS = new Set(["bash", "edit", "write"]);

const CLOSED_DECISION: PolicyDecision = {
	action: "deny",
	reason_code: "policy_adapter_failure",
	reason: "Pi Gauntlet could not obtain a valid shared-policy decision.",
	normalized_targets: [],
	protected_targets: [],
	mutation: true,
	policy_sensitive: true,
	covered: true,
};


function objectInput(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("covered Pi tool input must be an object");
	}
	return value as Record<string, unknown>;
}


function requiredString(
	input: Record<string, unknown>,
	keys: string[],
	label: string,
): string {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	throw new Error(`covered Pi ${label} input is missing`);
}


export function isCoveredBuiltin(
	toolName: string,
	sourceInfo: ToolSourceLike | undefined,
): boolean {
	if (!COVERED_TOOLS.has(toolName)) return false;
	return sourceInfo?.source === "builtin";
}


export function translatePiToolCall(event: ToolCallLike): SharedPolicyInput | null {
	if (!COVERED_TOOLS.has(event.toolName)) return null;
	const input = objectInput(event.input);

	if (event.toolName === "bash") {
		return {
			operation: "shell",
			text: requiredString(input, ["command"], "bash command"),
			targets: [],
		};
	}

	const path = requiredString(input, ["path", "file_path"], `${event.toolName} path`);
	const textKeys = event.toolName === "edit"
		? ["oldText", "newText", "old_string", "new_string"]
		: ["content"];
	const text = textKeys
		.map((key) => input[key])
		.filter((value): value is string => typeof value === "string")
		.join("\n");
	return {
		operation: event.toolName,
		text,
		targets: [path],
	};
}


function pythonCommand(): string {
	const prefix = process.env.PREFIX;
	return prefix ? join(prefix, "bin", "python3") : "python3";
}


function maintenanceTargets(): string[] {
	return (process.env.CODEX_GAUNTLET_MAINTENANCE_TARGETS ?? "")
		.split(",")
		.map((target) => target.trim())
		.filter(Boolean);
}


function validDecision(value: unknown): value is PolicyDecision {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Partial<PolicyDecision>;
	return (
		(candidate.action === "allow"
			|| candidate.action === "deny"
			|| candidate.action === "requires_human")
		&& typeof candidate.reason_code === "string"
		&& typeof candidate.reason === "string"
		&& Array.isArray(candidate.normalized_targets)
		&& Array.isArray(candidate.protected_targets)
		&& typeof candidate.mutation === "boolean"
		&& typeof candidate.policy_sensitive === "boolean"
		&& typeof candidate.covered === "boolean"
	);
}


export async function runSharedPolicy(
	input: SharedPolicyInput,
	cwd: string,
): Promise<PolicyDecision> {
	const payload = JSON.stringify({
		input,
		context: {
			cwd,
			repo_root: REPO_ROOT,
			maintenance_enabled: process.env.CODEX_GAUNTLET_MAINTENANCE === "1",
			maintenance_targets: maintenanceTargets(),
		},
	});

	return await new Promise<PolicyDecision>((resolveDecision) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const child = spawn(pythonCommand(), [POLICY_SCRIPT, "--json"], {
			cwd: REPO_ROOT,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const finish = (decision: PolicyDecision) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveDecision(decision);
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({
				...CLOSED_DECISION,
				reason: "Pi Gauntlet shared-policy decision timed out.",
			});
		}, POLICY_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (stdout.length > MAX_POLICY_OUTPUT) child.kill();
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-1_000);
		});
		child.on("error", () => finish(CLOSED_DECISION));
		child.on("close", (code) => {
			if (settled) return;
			if (code !== 0 || stdout.length > MAX_POLICY_OUTPUT) {
				finish({
					...CLOSED_DECISION,
					reason: stderr.trim()
						? `Pi Gauntlet shared-policy failure: ${stderr.trim()}`.slice(0, 240)
						: CLOSED_DECISION.reason,
				});
				return;
			}
			try {
				const parsed: unknown = JSON.parse(stdout);
				finish(validDecision(parsed) ? parsed : CLOSED_DECISION);
			} catch {
				finish(CLOSED_DECISION);
			}
		});
		child.stdin.end(payload);
	});
}
