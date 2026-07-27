import { safeIdentity, safeText, providerId } from "./validation.js";

function normalizeCredential(credential) {
	const id = safeIdentity(credential?.provider_id, 64);
	if (!id || !["api_key", "oauth"].includes(credential?.type)) {
		return undefined;
	}
	return {
		provider_id: id,
		provider_name: safeText(credential.provider_name, 96, id),
		type: credential.type,
	};
}

export function createCredentialService({ runtime, coordinator } = {}) {
	if (!runtime || typeof runtime.listCredentialMetadata !== "function") {
		throw new TypeError("runtime.listCredentialMetadata is required");
	}
	if (!coordinator) {
		throw new TypeError("coordinator is required");
	}
	return {
		async list() {
			const credentials = await runtime.listCredentialMetadata();
			return {
				object: "list",
				data: credentials
					.map(normalizeCredential)
					.filter(Boolean)
					.sort((left, right) => left.provider_name.localeCompare(right.provider_name)),
			};
		},
		async remove(value) {
			const selectedProvider = providerId(value);
			await coordinator.run(selectedProvider, () => runtime.logout(selectedProvider));
			return {
				object: "pi_router.credential_mutation",
				status: "removed",
				provider_id: selectedProvider,
			};
		},
	};
}
