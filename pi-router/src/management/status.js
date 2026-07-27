import { BINARY_BUILD, VERSION } from "../version.js";

export function createStatusService({
	account,
	providers,
	credentials,
	quota,
	events,
	config,
	updater,
	startedAt,
	now,
} = {}) {
	return {
		async get() {
			const [
				providerList,
				credentialList,
				quotaSummary,
				configSummary,
				update,
			] = await Promise.all([
				providers.list(),
				credentials.list(),
				quota.summary(),
				config.summary(),
				updater.status(),
			]);
			const configuredProviders = providerList.data
				.filter((provider) => provider.configured)
				.length;
			const availableModels = providerList.data
				.reduce((total, provider) => total + provider.available_model_count, 0);
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
					providers: providerList.data.length,
					configured_providers: configuredProviders,
					stored_credentials: credentialList.data.length,
					available_models: availableModels,
				},
				activity: events.summary(),
				quota: quotaSummary,
				config: configSummary,
				update,
			};
		},
	};
}
