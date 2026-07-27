import { createHash } from "node:crypto";

import { RouterError } from "../errors.js";
import {
	atomicWriteFile,
	compileRouterConfig,
	parseRouterConfig,
	readRouterConfig,
} from "../router-config.js";
import { conflict } from "./validation.js";

function revision(source) {
	return createHash("sha256").update(source).digest("hex");
}

function selectedRestartFields(document) {
	return {
		host: document.host,
		port: document.port,
		"remote-management": document["remote-management"],
		environment: document.environment,
	};
}

function equal(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export class RawConfigService {
	constructor({
		configPath,
		modelsPath,
		providerPolicyPath,
		runtime,
		eventLog,
	} = {}) {
		this.configPath = configPath;
		this.recoveryPath = configPath ? `${configPath}.previous` : undefined;
		this.modelsPath = modelsPath;
		this.providerPolicyPath = providerPolicyPath;
		this.runtime = runtime;
		this.eventLog = eventLog;
		this.active = false;
	}

	async get() {
		if (!this.configPath) {
			throw new RouterError("Raw configuration is unavailable.", {
				status: 501,
				code: "raw_config_unsupported",
				type: "invalid_request_error",
			});
		}
		const current = await readRouterConfig(this.configPath);
		return {
			...current,
			revision: revision(current.source),
		};
	}

	async summary() {
		if (!this.configPath) {
			return {
				supported: false,
				editable: false,
				recovery_available: false,
				state: "unsupported",
				raw: false,
			};
		}
		try {
			await this.get();
			let recoveryAvailable = false;
			try {
				await readRouterConfig(this.recoveryPath);
				recoveryAvailable = true;
			} catch {}
			return {
				supported: true,
				editable: true,
				recovery_available: recoveryAvailable,
				state: "ready",
				raw: true,
			};
		} catch {
			return {
				supported: true,
				editable: false,
				recovery_available: false,
				state: "invalid",
				raw: true,
			};
		}
	}

	async put(source) {
		if (this.active) {
			throw conflict(
				"A configuration mutation is already active.",
				"config_mutation_in_progress",
			);
		}
		this.active = true;
		try {
			const candidateSource = Buffer.isBuffer(source)
				? source.toString("utf8")
				: String(source ?? "");
			const candidate = parseRouterConfig(candidateSource);
			const current = await this.get();
			if (candidateSource === current.source) {
				return {
					object: "pi_router.raw_config_mutation",
					status: "unchanged",
					revision: current.revision,
					activation: "unchanged",
					restart_required: false,
				};
			}
			const restartRequired = !equal(
				selectedRestartFields(current.document),
				selectedRestartFields(candidate),
			);
			await atomicWriteFile(this.recoveryPath, current.source, { encoding: "utf8" });
			try {
				await compileRouterConfig({
					document: candidate,
					modelsPath: this.modelsPath,
					providerPolicyPath: this.providerPolicyPath,
				});
				await atomicWriteFile(this.configPath, candidateSource, { encoding: "utf8" });
			} catch (error) {
				await compileRouterConfig({
					document: current.document,
					modelsPath: this.modelsPath,
					providerPolicyPath: this.providerPolicyPath,
				}).catch(() => {});
				throw error;
			}
			this.eventLog?.setEnabled?.(candidate["request-logging"]);
			let activation = restartRequired ? "restart_required" : "reloaded";
			if (!restartRequired) {
				try {
					await this.runtime?.refreshConfiguration?.();
				} catch {
					activation = "restart_required";
				}
			}
			return {
				object: "pi_router.raw_config_mutation",
				status: "applied",
				revision: revision(candidateSource),
				activation,
				restart_required: activation === "restart_required",
			};
		} finally {
			this.active = false;
		}
	}
}
