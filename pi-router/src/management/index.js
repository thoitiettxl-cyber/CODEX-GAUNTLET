import { AuthSessionService } from "./auth-sessions.js";
import { ConfigService } from "./config.js";
import { createCredentialService } from "./credentials.js";
import { OperationalEventLog } from "./event-log.js";
import { ProviderMutationCoordinator } from "./mutations.js";
import { createProviderService } from "./providers.js";
import { createProxyKeyService } from "./proxy-keys.js";
import { createQuotaService } from "./quota.js";
import { RawConfigService } from "./raw-config.js";
import { defaultQuotaAdapters } from "./quota-adapters/index.js";
import { createStatusService } from "./status.js";

export function createManagementService({
	runtime,
	account = "default",
	updater,
	configPath,
	modelsPath,
	providerPolicyPath,
	startedAt = Date.now(),
	now = Date.now,
	eventLog = new OperationalEventLog({ now }),
	quotaAdapters = defaultQuotaAdapters,
	authSessionOptions = {},
	proxyKeyStore,
} = {}) {
	if (!runtime) {
		throw new TypeError("runtime is required");
	}
	if (!updater) {
		throw new TypeError("updater is required");
	}
	const coordinator = new ProviderMutationCoordinator();
	const proxyKeys = proxyKeyStore
		? createProxyKeyService({ store: proxyKeyStore })
		: undefined;
	const providers = createProviderService({ runtime });
	const credentials = createCredentialService({ runtime, coordinator });
	const quota = createQuotaService({
		providers,
		credentials,
		runtime,
		adapters: quotaAdapters,
		now,
	});
	const config = new ConfigService({ modelsPath, providerPolicyPath, runtime });
	const rawConfig = new RawConfigService({
		configPath,
		modelsPath,
		providerPolicyPath,
		runtime,
		eventLog,
	});
	const authSessions = new AuthSessionService({
		runtime,
		providers,
		coordinator,
		now,
		...authSessionOptions,
	});
	const status = createStatusService({
		account,
		providers,
		credentials,
		quota,
		events: eventLog,
		config: configPath ? rawConfig : config,
		updater,
		startedAt,
		now,
		proxyKeys,
	});
	return {
		status: () => status.get(),
		listProxyKeys: () => proxyKeys?.list(),
		createProxyKey: (body) => proxyKeys?.create(body),
		updateProxyKey: (id, body) => proxyKeys?.update(id, body),
		replaceProxyKey: (id, body) => proxyKeys?.replace(id, body),
		removeProxyKey: (id) => proxyKeys?.remove(id),
		listProviders: () => providers.list(),
		listCredentials: () => credentials.list(),
		removeCredential: (providerId) => credentials.remove(providerId),
		...(credentials.exportFile
			? { exportCredentialFile: (credentialId) => credentials.exportFile(credentialId) }
			: {}),
		...(credentials.importFile
			? { importCredentialFile: (source) => credentials.importFile(source) }
			: {}),
		createAuthSession: (body) => authSessions.create(body),
		getAuthSession: (id) => authSessions.get(id),
		respondAuthSession: (id, body) => authSessions.respond(id, body),
		cancelAuthSession: (id) => authSessions.cancel(id),
		listQuota: () => quota.list(),
		listEvents: (limit) => eventLog.list(limit),
		getConfig: () => config.get(),
		previewConfig: (body) => config.preview(body),
		applyConfig: (body) => config.apply(body),
		restoreConfig: (body) => config.restore(body),
		getRawConfig: () => rawConfig.get(),
		putRawConfig: (source) => rawConfig.put(source),
		checkUpdate: () => updater.check(),
		installUpdate: (version) => updater.install(version),
		rollbackUpdate: () => updater.rollback(),
	};
}

export { OperationalEventLog } from "./event-log.js";
