import { create } from "zustand";

import {
	errorMessage,
	ManagementClient,
	type ManagementStatus,
} from "../lib/api";
import {
	clearRememberedBearer,
	readRememberedBearer,
	rememberedBearerEnvelopePresent,
	saveRememberedBearer,
} from "../lib/storage/obfuscated";

type ConnectionPhase = "idle" | "checking" | "connected" | "error";

interface AuthState {
	phase: ConnectionPhase;
	bearerDraft: string;
	remember: boolean;
	client: ManagementClient | null;
	status: ManagementStatus | null;
	error: string;
	initialized: boolean;
	setBearerDraft: (value: string) => void;
	setRemember: (value: boolean) => void;
	initialize: () => Promise<void>;
	connect: () => Promise<boolean>;
	refreshStatus: () => Promise<void>;
	disconnect: () => void;
	clearLocalLogin: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
	phase: "idle",
	bearerDraft: "",
	remember: false,
	client: null,
	status: null,
	error: "",
	initialized: false,
	setBearerDraft: (bearerDraft) => set({ bearerDraft }),
	setRemember: (remember) => {
		if (!remember) {
			clearRememberedBearer();
		}
		set({ remember });
	},
	initialize: async () => {
		if (get().initialized) {
			return;
		}
		const remembered = readRememberedBearer();
		set({
			initialized: true,
			bearerDraft: remembered ?? "",
			remember: remembered !== null,
		});
	},
	connect: async () => {
		const bearer = get().bearerDraft.trim();
		if (!bearer) {
			return false;
		}
		set({ phase: "checking", error: "" });
		const client = new ManagementClient(bearer);
		try {
			const status = await client.status();
			const requestedRemember = get().remember;
			let remembered = false;
			if (requestedRemember) {
				remembered = saveRememberedBearer(bearer);
			} else {
				clearRememberedBearer();
			}
			set({
				phase: "connected",
				bearerDraft: "",
				remember: remembered,
				client,
				status,
				error: "",
			});
			return true;
		} catch (caught) {
			set({
				phase: "error",
				client: null,
				status: null,
				error: errorMessage(caught),
			});
			return false;
		}
	},
	refreshStatus: async () => {
		const client = get().client;
		if (!client) {
			return;
		}
		try {
			set({ status: await client.status(), error: "" });
		} catch (caught) {
			set({ error: errorMessage(caught) });
			throw caught;
		}
	},
	disconnect: () => {
		const remembered = readRememberedBearer();
		set({
			phase: "idle",
			bearerDraft: remembered ?? "",
			remember: remembered !== null,
			client: null,
			status: null,
			error: "",
		});
	},
	clearLocalLogin: () => {
		clearRememberedBearer();
		set({ remember: false });
	},
}));

export function hasRememberedLogin(): boolean {
	return rememberedBearerEnvelopePresent();
}
