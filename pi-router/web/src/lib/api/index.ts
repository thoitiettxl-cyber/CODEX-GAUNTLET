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
	state: ProviderState;
}

export interface CredentialInfo {
	provider_id: string;
	provider_name: string;
	type: AuthType;
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
	provider_id: string;
	provider_name: string;
	status: "available" | "unsupported" | "error";
	capability: "provider_adapter" | "none";
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
		requests: number;
		errors: number;
		last_event_at: string | null;
		retention: "memory";
	};
	quota: {
		supported_providers: number;
		total_providers: number;
	};
	config: {
		supported: boolean;
		editable: boolean;
		recovery_available: boolean;
		state: "ready" | "invalid" | "unsupported";
	};
	update: UpdateStatus;
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
		throw new Error(`${label} returned an invalid response.`);
	}
	return value;
}

function expectList<T>(value: unknown, label: string): T[] {
	const record = expectRecord(value, label);
	if (!Array.isArray(record.data)) {
		throw new Error(`${label} returned an invalid list.`);
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

	constructor(bearer: string) {
		this.bearer = bearer;
	}

	async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const headers = new Headers(options.headers);
		headers.set("authorization", `Bearer ${this.bearer}`);
		if (options.body !== undefined) {
			headers.set("content-type", "application/json");
		}
		let response: Response;
		try {
			response = await fetch(path, {
				...options,
				cache: "no-store",
				headers,
			});
		} catch {
			throw new ApiError("Pi Router is not reachable on this loopback origin.", 0, "network_error");
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new ApiError("Pi Router returned an invalid JSON response.", response.status, "invalid_response");
		}
		if (!response.ok) {
			const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
			throw new ApiError(
				typeof error.message === "string" ? error.message : "The request failed.",
				response.status,
				typeof error.code === "string" ? error.code : "request_failed",
			);
		}
		return payload as T;
	}

	async status(): Promise<ManagementStatus> {
		const result = await this.request<unknown>("/management/api/status");
		const record = expectRecord(result, "Status");
		if (record.object !== "pi_router.management_status") {
			throw new Error("Status returned an unexpected object.");
		}
		return result as ManagementStatus;
	}

	async providers(): Promise<ProviderInfo[]> {
		return expectList<ProviderInfo>(
			await this.request<unknown>("/management/api/providers"),
			"Providers",
		);
	}

	async credentials(): Promise<CredentialInfo[]> {
		return expectList<CredentialInfo>(
			await this.request<unknown>("/management/api/credentials"),
			"Credentials",
		);
	}

	removeCredential(providerId: string): Promise<unknown> {
		return this.request(`/management/api/credentials/${encodeURIComponent(providerId)}`, {
			method: "DELETE",
		});
	}

	createAuthSession(providerId: string, type: AuthType): Promise<AuthSession> {
		return this.request("/management/api/auth/sessions", {
			method: "POST",
			body: JSON.stringify({ provider_id: providerId, type }),
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
			"Quota",
		);
	}

	async events(limit = 100): Promise<OperationalEvent[]> {
		return expectList<OperationalEvent>(
			await this.request<unknown>(`/management/api/events?limit=${limit}`),
			"Events",
		);
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
	return error instanceof Error ? error.message : "The request failed.";
}
