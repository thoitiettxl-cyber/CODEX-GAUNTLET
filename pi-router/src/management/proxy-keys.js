import {
	exactKeys,
	requireRecord,
} from "./validation.js";
import { invalidRequest } from "../errors.js";

function keyId(value) {
	if (typeof value !== "string" || !/^key_[0-9a-f-]{36}$/u.test(value)) {
		throw invalidRequest("Proxy API-key id is invalid.", "invalid_proxy_key_id");
	}
	return value;
}

export function createProxyKeyService({ store } = {}) {
	if (!store || typeof store.list !== "function") {
		throw new TypeError("proxy key store is required");
	}
	return {
		list: () => store.list(),
		count: () => store.count(),
		create(input) {
			const body = requireRecord(input);
			exactKeys(body, new Set(["label"]));
			return store.create(body);
		},
		update(id, input) {
			const body = requireRecord(input);
			exactKeys(body, new Set(["label"]));
			return store.update(keyId(id), body);
		},
		replace(id, input) {
			const body = requireRecord(input);
			exactKeys(body, new Set());
			return store.replace(keyId(id));
		},
		remove: (id) => store.remove(keyId(id)),
	};
}
