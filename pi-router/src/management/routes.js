import { invalidRequest } from "../errors.js";
import {
	boundedInteger,
	exactKeys,
	requireRecord,
} from "./validation.js";

function decoded(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		throw invalidRequest("Route parameter is invalid.");
	}
}

export async function routeManagement({
	request,
	response,
	url,
	management,
	readJson,
	json,
	maxBodyBytes,
} = {}) {
	const method = request.method ?? "";
	const path = url.pathname;
	if (method === "GET" && path === "/management/api/status") {
		json(response, 200, await management.status());
		return true;
	}
	if (method === "GET" && path === "/management/api/providers") {
		json(response, 200, await management.listProviders());
		return true;
	}
	if (method === "GET" && path === "/management/api/proxy-keys") {
		json(response, 200, await management.listProxyKeys());
		return true;
	}
	if (method === "POST" && path === "/management/api/proxy-keys") {
		const body = await readJson(request, maxBodyBytes);
		json(response, 201, await management.createProxyKey(body));
		return true;
	}
	const proxyKeyMatch = path.match(
		/^\/management\/api\/proxy-keys\/([^/]+)(?:\/(replace))?$/u,
	);
	if (proxyKeyMatch) {
		const id = decoded(proxyKeyMatch[1]);
		const action = proxyKeyMatch[2];
		if (method === "PATCH" && !action) {
			const body = await readJson(request, maxBodyBytes);
			json(response, 200, await management.updateProxyKey(id, body));
			return true;
		}
		if (method === "POST" && action === "replace") {
			const body = await readJson(request, maxBodyBytes);
			json(response, 200, await management.replaceProxyKey(id, body));
			return true;
		}
		if (method === "DELETE" && !action) {
			json(response, 200, await management.removeProxyKey(id));
			return true;
		}
	}
	if (method === "GET" && path === "/management/api/credentials") {
		json(response, 200, await management.listCredentials());
		return true;
	}
	const credentialMatch = path.match(/^\/management\/api\/credentials\/([^/]+)$/u);
	if (method === "DELETE" && credentialMatch) {
		json(response, 200, await management.removeCredential(decoded(credentialMatch[1])));
		return true;
	}
	if (method === "POST" && path === "/management/api/auth/sessions") {
		const body = await readJson(request, maxBodyBytes);
		json(response, 201, await management.createAuthSession(body));
		return true;
	}
	const authMatch = path.match(
		/^\/management\/api\/auth\/sessions\/([^/]+)(?:\/(respond|cancel))?$/u,
	);
	if (authMatch) {
		const id = decoded(authMatch[1]);
		const action = authMatch[2];
		if (method === "GET" && !action) {
			json(response, 200, await management.getAuthSession(id));
			return true;
		}
		if (method === "POST" && action === "respond") {
			const body = await readJson(request, maxBodyBytes);
			json(response, 200, await management.respondAuthSession(id, body));
			return true;
		}
		if (method === "POST" && action === "cancel") {
			json(response, 200, await management.cancelAuthSession(id));
			return true;
		}
	}
	if (method === "GET" && path === "/management/api/quota") {
		json(response, 200, await management.listQuota());
		return true;
	}
	if (method === "GET" && path === "/management/api/events") {
		const rawLimit = url.searchParams.get("limit");
		const limit = rawLimit === null
			? 100
			: boundedInteger(rawLimit, "limit", { min: 1, max: 250 });
		json(response, 200, await management.listEvents(limit));
		return true;
	}
	if (method === "GET" && path === "/management/api/config") {
		json(response, 200, await management.getConfig());
		return true;
	}
	if (method === "POST" && path === "/management/api/config/preview") {
		const body = await readJson(request, maxBodyBytes);
		json(response, 200, await management.previewConfig(body));
		return true;
	}
	if (method === "POST" && path === "/management/api/config/apply") {
		const body = await readJson(request, maxBodyBytes);
		json(response, 200, await management.applyConfig(body));
		return true;
	}
	if (method === "POST" && path === "/management/api/config/restore") {
		const body = await readJson(request, maxBodyBytes);
		json(response, 200, await management.restoreConfig(body));
		return true;
	}
	if (method === "POST" && path === "/management/api/updates/check") {
		json(response, 200, await management.checkUpdate());
		return true;
	}
	if (method === "POST" && path === "/management/api/updates/install") {
		const body = requireRecord(await readJson(request, maxBodyBytes));
		exactKeys(body, new Set(["version"]));
		json(response, 200, await management.installUpdate(body.version));
		return true;
	}
	if (method === "POST" && path === "/management/api/updates/rollback") {
		json(response, 200, await management.rollbackUpdate());
		return true;
	}
	return false;
}
