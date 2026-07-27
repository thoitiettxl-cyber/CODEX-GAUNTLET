import { AuthSessionService } from "./auth-sessions.js";
import { ConfigService } from "./config.js";
import { createCredentialService } from "./credentials.js";
import { OperationalEventLog } from "./event-log.js";
import { ProviderMutationCoordinator } from "./mutations.js";
import { createProviderService } from "./providers.js";
import { createQuotaService } from "./quota.js";
import { defaultQuotaAdapters } from "./quota-adapters/index.js";
import { createStatusService } from "./status.js";

export function createManagementService({
	runtime,
	account = "default",
	updater,
	modelsPath,
	startedAt = Date.now(),
	now = Date.now,
	eventLog = new OperationalEventLog({ now }),
	quotaAdapters = defaultQuotaAdapters,
	authSessionOptions = {},
} = {}) {
	if (!runtime) {
		throw new TypeError("runtime is required");
	}
	if (!updater) {
		throw new TypeError("updater is required");
	}
	const coordinator = new ProviderMutationCoordinator();
	const providers = createProviderService({ runtime });
	const credentials = createCredentialService({ runtime, coordinator });
	const quota = createQuotaService({ providers, adapters: quotaAdapters, now });
	const config = new ConfigService({ modelsPath, runtime });
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
		config,
		updater,
		startedAt,
		now,
	});
	return {
		status: () => status.get(),
		listProviders: () => providers.list(),
		listCredentials: () => credentials.list(),
		removeCredential: (providerId) => credentials.remove(providerId),
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
		checkUpdate: () => updater.check(),
		installUpdate: (version) => updater.install(version),
		rollbackUpdate: () => updater.rollback(),
	};
}

export { OperationalEventLog } from "./event-log.js";
