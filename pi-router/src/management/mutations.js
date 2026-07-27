import { conflict } from "./validation.js";

export class ProviderMutationCoordinator {
	constructor() {
		this.active = new Set();
	}

	acquire(providerId) {
		if (this.active.has(providerId)) {
			throw conflict(
				`A credential mutation is already active for provider '${providerId}'.`,
				"provider_mutation_in_progress",
			);
		}
		this.active.add(providerId);
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.active.delete(providerId);
			}
		};
	}

	async run(providerId, operation) {
		const release = this.acquire(providerId);
		try {
			return await operation();
		} finally {
			release();
		}
	}

	isActive(providerId) {
		return this.active.has(providerId);
	}
}
