import { randomUUID } from "node:crypto";

import { invalidRequest, notFound } from "../errors.js";
import {
	boundedString,
	conflict,
	exactKeys,
	providerId,
	requireRecord,
	safeText,
	sessionId,
} from "./validation.js";

const AUTH_TYPES = new Set(["api_key", "oauth"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "expired"]);
const EVENT_TYPES = new Set(["info", "auth_url", "device_code", "progress"]);
const MAX_EVENTS = 40;

function isoTime(value) {
	return new Date(value).toISOString();
}

function safeUrl(value) {
	if (typeof value !== "string" || value.length > 4096) {
		return undefined;
	}
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

function publicPrompt(prompt, id) {
	const type = ["text", "secret", "select", "manual_code"].includes(prompt?.type)
		? prompt.type
		: "text";
	const result = {
		id,
		type,
		message: safeText(prompt?.message, 240, "Enter the requested value."),
	};
	if (type === "select") {
		result.options = Array.isArray(prompt?.options)
			? prompt.options.slice(0, 32).map((option, index) => ({
				id: safeText(option?.id, 96, `option-${index + 1}`),
				label: safeText(option?.label, 160, `Option ${index + 1}`),
				description: safeText(option?.description, 240, "") || undefined,
			}))
			: [];
	}
	return result;
}

function publicEvent(event, id, createdAt) {
	if (!event || !EVENT_TYPES.has(event.type)) {
		return undefined;
	}
	if (event.type === "auth_url") {
		const url = safeUrl(event.url);
		if (!url) {
			return undefined;
		}
		return {
			id,
			type: "auth_url",
			created_at: isoTime(createdAt),
			url,
			instructions: safeText(event.instructions, 240, "") || undefined,
		};
	}
	if (event.type === "device_code") {
		const verificationUri = safeUrl(event.verificationUri);
		const userCode = safeText(event.userCode, 96, "");
		if (!verificationUri || !userCode) {
			return undefined;
		}
		return {
			id,
			type: "device_code",
			created_at: isoTime(createdAt),
			user_code: userCode,
			verification_uri: verificationUri,
			interval_seconds: Number.isFinite(event.intervalSeconds)
				? Math.min(86_400, Math.max(0, Math.round(event.intervalSeconds)))
				: undefined,
			expires_in_seconds: Number.isFinite(event.expiresInSeconds)
				? Math.min(86_400, Math.max(0, Math.round(event.expiresInSeconds)))
				: undefined,
		};
	}
	if (event.type === "info") {
		const links = Array.isArray(event.links)
			? event.links.slice(0, 8).map((link) => {
				const url = safeUrl(link?.url);
				return url
					? {
						url,
						label: safeText(link?.label, 120, "") || undefined,
					}
					: undefined;
			}).filter(Boolean)
			: [];
		return {
			id,
			type: "info",
			created_at: isoTime(createdAt),
			message: safeText(event.message, 320, "Authentication information updated."),
			links,
		};
	}
	return {
		id,
		type: "progress",
		created_at: isoTime(createdAt),
		message: safeText(event.message, 320, "Authentication is in progress."),
	};
}

function publicSession(session) {
	return {
		object: "pi_router.auth_session",
		id: session.id,
		provider_id: session.providerId,
		provider_name: session.providerName,
		auth_type: session.authType,
		state: session.state,
		created_at: isoTime(session.createdAt),
		updated_at: isoTime(session.updatedAt),
		expires_at: isoTime(session.expiresAt),
		prompt: session.prompt,
		events: [...session.events],
		error_code: session.errorCode ?? null,
	};
}

export class AuthSessionService {
	constructor({
		runtime,
		providers,
		coordinator,
		now = Date.now,
		ttlMs = 5 * 60 * 1000,
		maxSessions = 16,
		schedule = setTimeout,
	} = {}) {
		if (!runtime || typeof runtime.login !== "function") {
			throw new TypeError("runtime.login is required");
		}
		if (!providers || typeof providers.list !== "function") {
			throw new TypeError("providers service is required");
		}
		if (!coordinator) {
			throw new TypeError("coordinator is required");
		}
		this.runtime = runtime;
		this.providers = providers;
		this.coordinator = coordinator;
		this.now = now;
		this.ttlMs = ttlMs;
		this.maxSessions = maxSessions;
		this.schedule = schedule;
		this.sessions = new Map();
	}

	#touch(session) {
		session.updatedAt = this.now();
	}

	#evictTerminal() {
		for (const [id, session] of this.sessions) {
			if (this.sessions.size < this.maxSessions) {
				return;
			}
			if (TERMINAL_STATES.has(session.state)) {
				this.sessions.delete(id);
			}
		}
		if (this.sessions.size >= this.maxSessions) {
			throw conflict(
				"Authentication session capacity is full.",
				"auth_session_capacity",
			);
		}
	}

	#expire(session) {
		if (TERMINAL_STATES.has(session.state) || this.now() < session.expiresAt) {
			return;
		}
		session.state = "expired";
		session.errorCode = "auth_session_expired";
		this.#touch(session);
		session.controller.abort();
		if (session.pending) {
			const pending = session.pending;
			session.pending = undefined;
			session.prompt = null;
			pending.cleanup();
			pending.reject(new Error("Authentication session expired"));
		}
	}

	#get(value) {
		const selectedId = sessionId(value);
		const session = this.sessions.get(selectedId);
		if (!session) {
			throw notFound();
		}
		this.#expire(session);
		return session;
	}

	#appendEvent(session, event) {
		const selected = publicEvent(
			event,
			`event_${(++session.eventSequence).toString(36)}`,
			this.now(),
		);
		if (!selected) {
			return;
		}
		session.events.push(selected);
		if (session.events.length > MAX_EVENTS) {
			session.events.splice(0, session.events.length - MAX_EVENTS);
		}
		this.#touch(session);
	}

	#prompt(session, incoming) {
		if (session.controller.signal.aborted) {
			return Promise.reject(new Error("Authentication session cancelled"));
		}
		if (session.pending) {
			return Promise.reject(new Error("Authentication prompt already active"));
		}
		const id = `prompt_${(++session.promptSequence).toString(36)}`;
		session.prompt = publicPrompt(incoming, id);
		session.state = "waiting_for_input";
		this.#touch(session);
		return new Promise((resolve, reject) => {
			let removed = false;
			const onPromptAbort = () => {
				if (session.pending?.id !== id) {
					return;
				}
				session.pending = undefined;
				session.prompt = null;
				if (!TERMINAL_STATES.has(session.state)) {
					session.state = "running";
					this.#touch(session);
				}
				cleanup();
				reject(new Error("Authentication prompt cancelled"));
			};
			const cleanup = () => {
				if (!removed) {
					removed = true;
					incoming?.signal?.removeEventListener("abort", onPromptAbort);
				}
			};
			session.pending = { id, resolve, reject, cleanup };
			if (incoming?.signal?.aborted) {
				onPromptAbort();
				return;
			}
			incoming?.signal?.addEventListener("abort", onPromptAbort, { once: true });
		});
	}

	async #run(session, release) {
		try {
			await this.runtime.login(session.providerId, session.authType, {
				signal: session.controller.signal,
				prompt: (prompt) => this.#prompt(session, prompt),
				notify: (event) => this.#appendEvent(session, event),
			});
			if (!TERMINAL_STATES.has(session.state)) {
				session.state = "completed";
				session.prompt = null;
				this.#touch(session);
			}
		} catch {
			if (!TERMINAL_STATES.has(session.state)) {
				session.state = session.controller.signal.aborted ? "cancelled" : "failed";
				session.errorCode = session.controller.signal.aborted
					? "auth_session_cancelled"
					: "authentication_failed";
				session.prompt = null;
				this.#touch(session);
			}
		} finally {
			if (session.pending) {
				const pending = session.pending;
				session.pending = undefined;
				pending.cleanup();
				pending.reject(new Error("Authentication session ended"));
			}
			release();
		}
	}

	async create(input) {
		const body = requireRecord(input);
		exactKeys(body, new Set(["provider_id", "type"]));
		const selectedProvider = providerId(body.provider_id);
		if (!AUTH_TYPES.has(body.type)) {
			throw invalidRequest("type must be api_key or oauth.", "invalid_auth_type");
		}
		const providerList = await this.providers.list();
		const selected = providerList.data.find((provider) => provider.id === selectedProvider);
		if (!selected) {
			throw invalidRequest("Unknown provider.", "provider_not_found");
		}
		const mode = selected.auth_modes.find((entry) => entry.type === body.type);
		if (!mode?.login_supported) {
			throw invalidRequest(
				"The selected provider does not support this browser login method.",
				"auth_method_unsupported",
			);
		}
		this.#evictTerminal();
		const release = this.coordinator.acquire(selectedProvider);
		const createdAt = this.now();
		const session = {
			id: randomUUID(),
			providerId: selectedProvider,
			providerName: selected.name,
			authType: body.type,
			state: "running",
			createdAt,
			updatedAt: createdAt,
			expiresAt: createdAt + this.ttlMs,
			controller: new AbortController(),
			prompt: null,
			pending: undefined,
			promptSequence: 0,
			events: [],
			eventSequence: 0,
			errorCode: undefined,
		};
		this.sessions.set(session.id, session);
		const timer = this.schedule(() => {
			const current = this.sessions.get(session.id);
			if (current) {
				current.expiresAt = Math.min(current.expiresAt, this.now());
				this.#expire(current);
			}
		}, this.ttlMs);
		timer?.unref?.();
		void this.#run(session, release);
		return publicSession(session);
	}

	get(value) {
		return publicSession(this.#get(value));
	}

	respond(value, input) {
		const session = this.#get(value);
		if (TERMINAL_STATES.has(session.state)) {
			throw conflict("Authentication session is no longer active.", "auth_session_terminal");
		}
		const body = requireRecord(input);
		exactKeys(body, new Set(["prompt_id", "value"]));
		const promptId = boundedString(body.prompt_id, "prompt_id", { max: 64 });
		const response = boundedString(body.value, "value", {
			min: 0,
			max: 16_384,
			trim: false,
		});
		if (!session.pending || session.pending.id !== promptId) {
			throw conflict("Authentication prompt is stale or already answered.", "auth_prompt_stale");
		}
		const pending = session.pending;
		session.pending = undefined;
		session.prompt = null;
		session.state = "running";
		this.#touch(session);
		pending.cleanup();
		pending.resolve(response);
		return publicSession(session);
	}

	cancel(value) {
		const session = this.#get(value);
		if (TERMINAL_STATES.has(session.state)) {
			return publicSession(session);
		}
		session.state = "cancelled";
		session.errorCode = "auth_session_cancelled";
		session.prompt = null;
		this.#touch(session);
		session.controller.abort();
		if (session.pending) {
			const pending = session.pending;
			session.pending = undefined;
			pending.cleanup();
			pending.reject(new Error("Authentication session cancelled"));
		}
		return publicSession(session);
	}
}
