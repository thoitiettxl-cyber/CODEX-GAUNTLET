import { notFound } from "../errors.js";
import { safeIdentity, safeText, providerId } from "./validation.js";

function normalizeCredential(credential) {
	const provider = safeIdentity(credential?.provider_id, 64);
	const id = safeIdentity(credential?.id, 64) ?? provider;
	const accountId = safeIdentity(credential?.account_id, 64) ?? "default";
	if (!id || !provider || !["api_key", "oauth"].includes(credential?.type)) {
		return undefined;
	}
	return {
		id,
		account_id: accountId,
		account_label: safeText(credential.account_label, 96, accountId),
		provider_id: provider,
		provider_name: safeText(credential.provider_name, 96, provider),
		type: credential.type,
		label: safeText(
			credential.label,
			96,
			`${safeText(credential.provider_name, 96, provider)} · ${accountId}`,
		),
		active: credential.active === true || credential.account_id === undefined,
		created_at: typeof credential.created_at === "string" ? credential.created_at : null,
		updated_at: typeof credential.updated_at === "string" ? credential.updated_at : null,
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
					.sort((left, right) =>
						left.provider_name.localeCompare(right.provider_name)
						|| left.label.localeCompare(right.label)),
			};
		},
		async remove(value) {
			const credentials = (await this.list()).data;
			const selected = credentials.find((entry) => entry.id === value);
			if (!selected) {
				const selectedProvider = providerId(value);
				const legacy = credentials.find((entry) =>
					entry.provider_id === selectedProvider && entry.active);
				if (!legacy) {
					throw notFound();
				}
				await coordinator.run(
					`${legacy.account_id}:${legacy.provider_id}`,
					() => runtime.logout(legacy.provider_id),
				);
				return {
					object: "pi_router.credential_mutation",
					status: "removed",
					credential_id: legacy.id,
					account_id: legacy.account_id,
					provider_id: legacy.provider_id,
				};
			}
			await coordinator.run(
				`${selected.account_id}:${selected.provider_id}`,
				async () => {
					if (typeof runtime.logoutCredential === "function") {
						const removed = await runtime.logoutCredential(selected.id);
						if (!removed) {
							throw notFound();
						}
					} else {
						await runtime.logout(selected.provider_id);
					}
				},
			);
			return {
				object: "pi_router.credential_mutation",
				status: "removed",
				credential_id: selected.id,
				account_id: selected.account_id,
				provider_id: selected.provider_id,
			};
		},
	};
}
