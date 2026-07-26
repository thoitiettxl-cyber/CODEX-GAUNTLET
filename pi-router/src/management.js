import { BINARY_BUILD, VERSION } from "./version.js";

export function createManagementService({
	runtime,
	account = "default",
	updater,
	startedAt = Date.now(),
	now = Date.now,
} = {}) {
	if (!runtime) {
		throw new TypeError("runtime is required");
	}
	if (!updater) {
		throw new TypeError("updater is required");
	}
	return {
		async status() {
			const [models, update] = await Promise.all([
				runtime.listModels(),
				updater.status(),
			]);
			return {
				object: "pi_router.management_status",
				service: {
					name: "pi-router",
					version: VERSION,
					status: "ok",
					uptime_seconds: Math.max(0, Math.floor((now() - startedAt) / 1000)),
				},
				runtime: {
					mode: BINARY_BUILD ? "termux-binary" : "source",
					node: process.versions.node,
					platform: process.platform,
					arch: process.arch,
				},
				account: {
					id: account,
					available_models: models.length,
				},
				update,
			};
		},
		checkUpdate() {
			return updater.check();
		},
		installUpdate(version) {
			return updater.install(version);
		},
		rollbackUpdate() {
			return updater.rollback();
		},
	};
}
