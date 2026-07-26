import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";


export const STOP_COMMAND = "./qa/verify --mode stop";
export const MAX_CAPTURE = 3_500;
const MAX_WORKTREE_CAPTURE = 12_000;
const VERIFY_TIMEOUT_MS = 180_000;


function tail(value: string, limit: number): string {
	return value.length <= limit ? value : value.slice(-limit);
}


function signature(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}


export class MutationVerification {
	private mutationEpoch = 0;
	private verifiedEpoch = 0;
	private inFlight = false;
	private attemptedStateSignature = "";
	private repairFollowUpSent = false;

	public constructor(
		private readonly pi: ExtensionAPI,
		private readonly repoRoot: string,
	) {}

	public recordSuccessfulMutation(toolName: string, ctx: ExtensionContext): void {
		this.mutationEpoch += 1;
		this.pi.appendEntry("pi-gauntlet-mutation", {
			epoch: this.mutationEpoch,
			tool: toolName,
		});
		if (ctx.hasUI) {
			ctx.ui.notify(
				"Pi Gauntlet observed a successful mutation; canonical verification is pending.",
				"warning",
			);
		}
	}

	public resetRepairBudget(): void {
		this.repairFollowUpSent = false;
	}

	public probeState(): Record<string, unknown> {
		return {
			command: STOP_COMMAND,
			mutation_aware: true,
			in_flight_guard: true,
			failure_signature_guard: true,
			max_capture: MAX_CAPTURE,
		};
	}

	// Called only from Pi's agent_settled event.
	public async settle(ctx: ExtensionContext): Promise<void> {
		if (this.inFlight || this.mutationEpoch <= this.verifiedEpoch) return;
		const epoch = this.mutationEpoch;
		this.inFlight = true;
		try {
			const status = await this.pi.exec(
				"git",
				["-C", this.repoRoot, "status", "--short", "--untracked-files=all"],
				{ timeout: 5_000 },
			);
			const worktree = tail(
				`${status.code}\n${status.stdout}\n${status.stderr}`,
				MAX_WORKTREE_CAPTURE,
			);
			const stateSignature = signature(`${epoch}\0${worktree}`);
			if (stateSignature === this.attemptedStateSignature) return;

			const result = await this.pi.exec(
				join(this.repoRoot, "qa", "verify"),
				["--mode", "stop"],
				{ timeout: VERIFY_TIMEOUT_MS },
			);
			const output = tail(`${result.stdout}\n${result.stderr}`.trim(), MAX_CAPTURE);
			this.attemptedStateSignature = stateSignature;
			if (result.code === 0) {
				this.verifiedEpoch = epoch;
				this.repairFollowUpSent = false;
				this.pi.appendEntry("pi-gauntlet-verification", {
					epoch,
					ok: true,
					command: STOP_COMMAND,
				});
				if (ctx.hasUI) {
					ctx.ui.notify("Pi Gauntlet Stop verification passed.", "info");
				}
				return;
			}

			const failureSignature = signature(
				`${stateSignature}\0${result.code}\0${output}`,
			);
			this.pi.appendEntry("pi-gauntlet-verification", {
				epoch,
				ok: false,
				command: STOP_COMMAND,
				failureSignature,
			});
			if (this.repairFollowUpSent) return;
			this.repairFollowUpSent = true;
			this.pi.sendMessage(
				{
					customType: "pi-gauntlet-repair",
					content: [
						"Canonical verification failed after a successful mutation.",
						"Repair the bounded failure below, then let the agent settle again.",
						output || `verification exited with code ${result.code}`,
					].join("\n\n"),
					display: true,
					details: { failureSignature, epoch },
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} finally {
			this.inFlight = false;
		}
	}
}
