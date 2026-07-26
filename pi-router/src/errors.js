export class RouterError extends Error {
	constructor(message, { status = 500, code = "internal_error", type = "server_error", expose = true } = {}) {
		super(message);
		this.name = "RouterError";
		this.status = status;
		this.code = code;
		this.type = type;
		this.expose = expose;
	}
}

export function invalidRequest(message, code = "invalid_request") {
	return new RouterError(message, {
		status: 400,
		code,
		type: "invalid_request_error",
	});
}

export function unauthorized() {
	return new RouterError("Invalid or missing local API key.", {
		status: 401,
		code: "invalid_api_key",
		type: "authentication_error",
	});
}

export function notFound() {
	return new RouterError("Route not found.", {
		status: 404,
		code: "not_found",
		type: "invalid_request_error",
	});
}

export function safeError(error) {
	if (error instanceof RouterError) {
		return error;
	}
	return new RouterError("The provider request failed.", {
		status: 502,
		code: "provider_error",
		type: "server_error",
		expose: false,
	});
}

export function errorEnvelope(error) {
	const safe = safeError(error);
	return {
		error: {
			message: safe.expose ? safe.message : "The provider request failed.",
			type: safe.type,
			param: null,
			code: safe.code,
		},
	};
}
