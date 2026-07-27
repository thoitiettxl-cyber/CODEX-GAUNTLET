import axios, { type AxiosInstance } from "axios";

import i18n from "../../i18n";

export type ProviderState = "available" | "configured" | "unconfigured" | "error";
export type AuthType = "api_key" | "oauth";

export interface ProviderInfo {
	id: string;
	name: string;
	auth_modes: Array<{ type: AuthType; login_supported: boolean }>;
	configured: boolean;
	configured_source: string | null;
	credential_type: AuthType | null;
	model_count: number;
	available_model_count: number;
	credential_count: number;
	configuration_required: string | null;
	state: ProviderState;
}

export interface CredentialInfo {
	id: string;
	account_id: string;
	account_label: string;
	provider_id: string;
	provider_name: string;
	type: AuthType;
	label: string;
	active: boolean;
	created_at: string | null;
	updated_at: string | null;
	models?: string[];
	excluded_models?: string[];
	model_aliases?: Record<string, string>;
	runtime_only?: boolean;
	capabilities?: {
		models?: boolean;
		excluded_models?: boolean;
		model_aliases?: boolean;
	};
}

export interface ModelInfo {
	id: string;
	object: "model";
	owned_by: string;
}

export interface ProxyKeyInfo {
	id: string;
	label: string;
	created_at: string;
	updated_at: string;
}

export interface ProxyKeyMutation extends ProxyKeyInfo {
	object: "pi_router.proxy_api_key";
	status: "created" | "updated" | "replaced";
	value?: string;
}

export interface AuthPrompt {
	id: string;
	type: "text" | "secret" | "select" | "manual_code";
	message: string;
	placeholder?: string;
	options?: Array<{ id: string; label: string; description?: string }>;
}

export interface AuthEvent {
	id: string;
	type: "info" | "auth_url" | "device_code" | "progress";
	created_at: string;
	message?: string;
	url?: string;
	instructions?: string;
	user_code?: string;
	verification_uri?: string;
	links?: Array<{ url: string; label?: string }>;
}

export interface AuthSession {
	object: "pi_router.auth_session";
	id: string;
	provider_id: string;
	provider_name: string;
	account_id: string;
	account_label: string;
	credential_id: string | null;
	credential_label: string | null;
	auth_type: AuthType;
	state: "running" | "waiting_for_input" | "completed" | "failed" | "cancelled" | "expired";
	created_at: string;
	updated_at: string;
	expires_at: string;
	prompt: AuthPrompt | null;
	events: AuthEvent[];
	error_code: string | null;
}

export interface QuotaWindow {
	label: string;
	unit: string;
	used: number;
	limit: number;
	remaining: number;
	resets_at: string | null;
}

export interface QuotaResult {
	credential_id: string;
	credential_label: string;
	account_id: string;
	account_label: string;
	active: boolean;
	provider_id: string;
	provider_name: string;
	credential_type: AuthType;
	status: "available" | "unsupported" | "error";
	capability: "credential_adapter" | "none";
	windows: QuotaWindow[];
	checked_at?: string;
	error_code?: string;
}

export interface OperationalEvent {
	id: string;
	timestamp: string;
	request_class: string;
	status: number;
	duration_ms: number;
	model?: string;
	provider?: string;
	error_code?: string;
}

export interface ConfigError {
	path: string;
	message: string;
}

export interface ConfigChange {
	path: string;
	before: string | null;
	after: string | null;
}

export interface ConfigState {
	object: "pi_router.config";
	supported: boolean;
	editable: boolean;
	reason: string | null;
	revision: string | null;
	document: Record<string, unknown> | null;
	errors: ConfigError[];
	recovery_available: boolean;
}

export interface ConfigPreview {
	object: "pi_router.config_preview";
	valid: boolean;
	revision: string | null;
	errors: ConfigError[];
	changed: boolean;
	changes: ConfigChange[];
}

export interface ConfigMutation {
	object: "pi_router.config_mutation";
	status: "applied" | "restored" | "unchanged";
	revision: string;
	activation: "reloaded" | "restart_required" | "unchanged";
	restart_required: boolean;
	recovery_available: boolean;
	changes: ConfigChange[];
	changes_truncated?: boolean;
}

export interface UpdateStatus {
	repository: string;
	channel: string;
	automatic: boolean;
	install_supported: boolean;
	rollback_available: boolean;
	restart_required: boolean;
	pending_version: string | null;
}

export interface ManagementStatus {
	object: "pi_router.management_status";
	connection: {
		status: "connected";
		management_authenticated: boolean;
	};
	authentication: {
		management_key_configured: boolean;
		proxy_api_keys: number;
	};
	service: {
		name: string;
		version: string;
		status: string;
		uptime_seconds: number;
	};
	runtime: {
		mode: "source" | "termux-binary";
		node: string;
		platform: string;
		arch: string;
	};
	account: {
		id: string;
		providers: number;
		configured_providers: number;
		stored_credentials: number;
		available_models: number;
	};
	activity: {
		enabled: boolean;
		requests: number;
		errors: number;
		last_event_at: string | null;
		retention: "memory";
	};
	capabilities: {
		raw_config: boolean;
		credential_import_export: boolean;
		custom_provider_protocols: string[];
		inference_endpoints: string[];
		request_logging: boolean;
	};
	quota: {
		supported_providers: number;
		total_providers: number;
		supported_credentials: number;
		total_credentials: number;
	};
	config: {
		supported: boolean;
		editable: boolean;
		recovery_available: boolean;
		state: "ready" | "invalid" | "unsupported";
	};
	update: UpdateStatus;
}

export interface RawConfigState {
	source: string;
	revision: string;
}

export interface RawConfigMutation {
	object: "pi_router.raw_config_mutation";
	status: "applied" | "unchanged";
	revision: string;
	activation: "reloaded" | "restart_required" | "unchanged";
	restart_required: boolean;
}

export interface UpdateCandidate {
	status: "available" | "current";
	current_version: string;
	latest_version: string;
	published_at: string;
	release_url: string;
	asset: { name: string; size: number };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): JsonRecord {
	if (!isRecord(value)) {
		throw new Error(i18n.t("errors.invalidResponse", { label }));
	}
	return value;
}

function expectList<T>(value: unknown, label: string): T[] {
	const record = expectRecord(value, label);
	if (!Array.isArray(record.data)) {
		throw new Error(i18n.t("errors.invalidList", { label }));
	}
	return record.data as T[];
}

export class ApiError extends Error {
	status: number;
	code: string;

	constructor(message: string, status: number, code: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

export class ManagementClient {
	readonly bearer: string;
	readonly instance: AxiosInstance;

	constructor(bearer: string) {
		this.bearer = bearer;
		this.instance = axios.create({
			baseURL: window.location.origin,
			timeout: 20_000,
			withXSRFToken: false,
			headers: {
				accept: "application/json",
			},
		});
		this.instance.interceptors.request.use((config) => {
			config.headers.Authorization = `Bearer ${this.bearer}`;
			return config;
		});
	}

	async request<T>(
		path: string,
		options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: string } = {},
	): Promise<T> {
		try {
			const response = await this.instance.request<T>({
				url: path,
				method: options.method ?? "GET",
				data: options.body === undefined ? undefined : JSON.parse(options.body),
			});
			return response.data;
		} catch (caught) {
			if (!axios.isAxiosError(caught)) {
				throw caught;
			}
			if (!caught.response) {
				throw new ApiError(
					i18n.t("errors.network"),
					0,
					"network_error",
				);
			}
			const payload: unknown = caught.response.data;
			const error = isRecord(payload) && isRecord(payload.error)
				? payload.error
				: {};
			throw new ApiError(
				typeof error.message === "string"
					? error.message
					: i18n.t("errors.requestFailed"),
				caught.response.status,
				typeof error.code === "string" ? error.code : "request_failed",
			);
		}
	}

	async status(): Promise<ManagementStatus> {
		const result = await this.request<unknown>("/management/api/status");
		const record = expectRecord(result, i18n.t("errors.labels.status"));
		if (record.object !== "pi_router.management_status") {
			throw new Error(i18n.t("errors.unexpectedStatus"));
		}
		return result as ManagementStatus;
	}

	async providers(): Promise<ProviderInfo[]> {
		return expectList<ProviderInfo>(
			await this.request<unknown>("/management/api/providers"),
			i18n.t("errors.labels.providers"),
		);
	}

	async credentials(): Promise<CredentialInfo[]> {
		return expectList<CredentialInfo>(
			await this.request<unknown>("/management/api/credentials"),
			i18n.t("errors.labels.credentials"),
		);
	}

	async proxyKeys(): Promise<ProxyKeyInfo[]> {
		return expectList<ProxyKeyInfo>(
			await this.request<unknown>("/management/api/proxy-keys"),
			i18n.t("errors.labels.proxyKeys"),
		);
	}

	createProxyKey(label: string): Promise<ProxyKeyMutation> {
		return this.request("/management/api/proxy-keys", {
			method: "POST",
			body: JSON.stringify({ label }),
		});
	}

	updateProxyKey(id: string, label: string): Promise<ProxyKeyMutation> {
		return this.request(`/management/api/proxy-keys/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify({ label }),
		});
	}

	replaceProxyKey(id: string): Promise<ProxyKeyMutation> {
		return this.request(
			`/management/api/proxy-keys/${encodeURIComponent(id)}/replace`,
			{ method: "POST", body: JSON.stringify({}) },
		);
	}

	removeProxyKey(id: string): Promise<unknown> {
		return this.request(`/management/api/proxy-keys/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}

	removeCredential(credentialId: string): Promise<unknown> {
		return this.request(`/management/api/credentials/${encodeURIComponent(credentialId)}`, {
			method: "DELETE",
		});
	}

	async rawConfig(): Promise<RawConfigState> {
		try {
			const response = await this.instance.get<string>("/v0/management/config.yaml", {
				responseType: "text",
				transformResponse: [(value) => value],
			});
			return {
				source: response.data,
				revision: String(response.headers.etag ?? "").replace(/^"|"$/gu, ""),
			};
		} catch (caught) {
			throw this.apiError(caught);
		}
	}

	async putRawConfig(source: string): Promise<RawConfigMutation> {
		try {
			const response = await this.instance.put<RawConfigMutation>(
				"/v0/management/config.yaml",
				source,
				{ headers: { "content-type": "application/yaml; charset=utf-8" } },
			);
			return response.data;
		} catch (caught) {
			throw this.apiError(caught);
		}
	}

	async importCredentialFile(file: File): Promise<unknown> {
		try {
			const response = await this.instance.post(
				`/v0/management/auth-files?name=${encodeURIComponent(file.name)}`,
				await file.text(),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
			return response.data;
		} catch (caught) {
			throw this.apiError(caught);
		}
	}

	async exportCredentialFile(credentialId: string): Promise<Blob> {
		try {
			const response = await this.instance.get(
				`/v0/management/auth-files/download?name=${encodeURIComponent(credentialId)}`,
				{ responseType: "blob" },
			);
			return response.data as Blob;
		} catch (caught) {
			throw this.apiError(caught);
		}
	}

	private apiError(caught: unknown): Error {
		if (!axios.isAxiosError(caught)) {
			return caught instanceof Error ? caught : new Error(i18n.t("errors.requestFailed"));
		}
		if (!caught.response) {
			return new ApiError(i18n.t("errors.network"), 0, "network_error");
		}
		const payload: unknown = caught.response.data;
		const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
		return new ApiError(
			typeof error.message === "string" ? error.message : i18n.t("errors.requestFailed"),
			caught.response.status,
			typeof error.code === "string" ? error.code : "request_failed",
		);
	}

	createAuthSession(
		providerId: string,
		type: AuthType,
		options: { accountId?: string; label?: string } = {},
	): Promise<AuthSession> {
		return this.request("/management/api/auth/sessions", {
			method: "POST",
			body: JSON.stringify({
				provider_id: providerId,
				type,
				...(options.accountId ? { account_id: options.accountId } : {}),
				...(options.label ? { label: options.label } : {}),
			}),
		});
	}

	getAuthSession(id: string): Promise<AuthSession> {
		return this.request(`/management/api/auth/sessions/${encodeURIComponent(id)}`);
	}

	respondAuthSession(id: string, promptId: string, value: string): Promise<AuthSession> {
		return this.request(
			`/management/api/auth/sessions/${encodeURIComponent(id)}/respond`,
			{
				method: "POST",
				body: JSON.stringify({ prompt_id: promptId, value }),
			},
		);
	}

	cancelAuthSession(id: string): Promise<AuthSession> {
		return this.request(
			`/management/api/auth/sessions/${encodeURIComponent(id)}/cancel`,
			{ method: "POST" },
		);
	}

	async quota(): Promise<QuotaResult[]> {
		return expectList<QuotaResult>(
			await this.request<unknown>("/management/api/quota"),
			i18n.t("errors.labels.quota"),
		);
	}

	async events(limit = 100): Promise<OperationalEvent[]> {
		return expectList<OperationalEvent>(
			await this.request<unknown>(`/management/api/events?limit=${limit}`),
			i18n.t("errors.labels.events"),
		);
	}

	async models(proxyKey: string): Promise<ModelInfo[]> {
		try {
			const response = await axios.get<unknown>("/v1/models", {
				baseURL: window.location.origin,
				timeout: 20_000,
				withXSRFToken: false,
				headers: {
					authorization: `Bearer ${proxyKey}`,
					accept: "application/json",
				},
			});
			return expectList<ModelInfo>(
				response.data,
				i18n.t("errors.labels.models"),
			);
		} catch (caught) {
			if (axios.isAxiosError(caught)) {
				const payload: unknown = caught.response?.data;
				const error = isRecord(payload) && isRecord(payload.error)
					? payload.error
					: {};
				throw new ApiError(
					typeof error.message === "string"
						? error.message
						: (caught.response
							? i18n.t("errors.modelRequestFailed")
							: i18n.t("errors.network")),
					caught.response?.status ?? 0,
					typeof error.code === "string" ? error.code : "model_request_failed",
				);
			}
			throw caught;
		}
	}

	getConfig(): Promise<ConfigState> {
		return this.request("/management/api/config");
	}

	previewConfig(document: Record<string, unknown>): Promise<ConfigPreview> {
		return this.request("/management/api/config/preview", {
			method: "POST",
			body: JSON.stringify({ document }),
		});
	}

	applyConfig(
		document: Record<string, unknown>,
		expectedRevision: string,
	): Promise<ConfigMutation> {
		return this.request("/management/api/config/apply", {
			method: "POST",
			body: JSON.stringify({
				document,
				expected_revision: expectedRevision,
			}),
		});
	}

	restoreConfig(expectedRevision: string): Promise<ConfigMutation> {
		return this.request("/management/api/config/restore", {
			method: "POST",
			body: JSON.stringify({ expected_revision: expectedRevision }),
		});
	}

	checkUpdate(): Promise<UpdateCandidate> {
		return this.request("/management/api/updates/check", { method: "POST" });
	}

	installUpdate(version: string): Promise<Record<string, unknown>> {
		return this.request("/management/api/updates/install", {
			method: "POST",
			body: JSON.stringify({ version }),
		});
	}

	rollbackUpdate(): Promise<Record<string, unknown>> {
		return this.request("/management/api/updates/rollback", { method: "POST" });
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : i18n.t("errors.requestFailed");
}
