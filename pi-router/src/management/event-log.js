import { boundedInteger, safeIdentity, safeText } from "./validation.js";

const REQUEST_CLASSES = new Set([
	"console",
	"health",
	"models",
	"responses",
	"management.status",
	"management.providers",
	"management.proxy_keys",
	"management.credentials",
	"management.auth",
	"management.quota",
	"management.events",
	"management.config",
	"management.updates",
	"not_found",
]);

function requestClass(method, pathname) {
	if (["GET", "HEAD"].includes(method) && ["/", "/management.html"].includes(pathname)) {
		return "console";
	}
	if (method === "GET" && pathname === "/health") {
		return "health";
	}
	if (pathname === "/v1/models") {
		return "models";
	}
	if (pathname === "/v1/responses") {
		return "responses";
	}
	if (pathname === "/management/api/status") {
		return "management.status";
	}
	if (pathname === "/management/api/providers") {
		return "management.providers";
	}
	if (pathname.startsWith("/management/api/proxy-keys")) {
		return "management.proxy_keys";
	}
	if (pathname.startsWith("/management/api/credentials")) {
		return "management.credentials";
	}
	if (pathname.startsWith("/management/api/auth/")) {
		return "management.auth";
	}
	if (pathname === "/management/api/quota") {
		return "management.quota";
	}
	if (pathname === "/management/api/events") {
		return "management.events";
	}
	if (pathname.startsWith("/management/api/config")) {
		return "management.config";
	}
	if (pathname.startsWith("/management/api/updates/")) {
		return "management.updates";
	}
	return "not_found";
}

export class OperationalEventLog {
	constructor({ capacity = 250, now = Date.now } = {}) {
		this.capacity = boundedInteger(capacity, "event capacity", { min: 1, max: 1000 });
		this.now = now;
		this.events = [];
		this.sequence = 0;
	}

	classify(method, pathname) {
		return requestClass(method, pathname);
	}

	record({
		requestClass: selectedClass,
		status,
		durationMs,
		model,
		provider,
		errorCode,
	} = {}) {
		const normalizedClass = REQUEST_CLASSES.has(selectedClass)
			? selectedClass
			: "not_found";
		const normalizedStatus = Number.isInteger(status) && status >= 100 && status <= 599
			? status
			: 500;
		const event = {
			id: `evt_${(++this.sequence).toString(36)}`,
			timestamp: new Date(this.now()).toISOString(),
			request_class: normalizedClass,
			status: normalizedStatus,
			duration_ms: Math.min(86_400_000, Math.max(0, Math.round(Number(durationMs) || 0))),
		};
		const selectedModel = safeIdentity(model);
		const selectedProvider = safeIdentity(provider, 64);
		const selectedCode = safeText(errorCode, 64, "");
		if (selectedModel) {
			event.model = selectedModel;
		}
		if (selectedProvider) {
			event.provider = selectedProvider;
		}
		if (selectedCode && /^[a-z][a-z0-9_]*$/u.test(selectedCode)) {
			event.error_code = selectedCode;
		}
		this.events.push(Object.freeze(event));
		if (this.events.length > this.capacity) {
			this.events.splice(0, this.events.length - this.capacity);
		}
		return event;
	}

	list(limit = 100) {
		const selectedLimit = boundedInteger(limit, "limit", {
			min: 1,
			max: this.capacity,
			defaultValue: 100,
		});
		return {
			object: "list",
			data: this.events.slice(-selectedLimit).reverse(),
			has_more: this.events.length > selectedLimit,
			retention: {
				mode: "memory",
				capacity: this.capacity,
			},
		};
	}

	summary() {
		const errors = this.events.filter((event) => event.status >= 400).length;
		return {
			requests: this.events.length,
			errors,
			last_event_at: this.events.at(-1)?.timestamp ?? null,
			retention: "memory",
		};
	}
}
