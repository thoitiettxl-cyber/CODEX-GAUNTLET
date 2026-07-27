const ENVELOPE_PREFIX = "enc::v1::";
const STORAGE_KEY = "pi-router.management.auth";
const OBFUSCATION_SALT = "pi-router::management-console::v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function keyBytes(): Uint8Array {
	if (typeof window === "undefined" || typeof navigator === "undefined") {
		throw new Error("Browser storage is unavailable.");
	}
	const origin = window.location.origin;
	const agent = navigator.userAgent;
	return encoder.encode(`${OBFUSCATION_SALT}|${origin}|${agent}`);
}

function xor(input: Uint8Array, key: Uint8Array): Uint8Array {
	if (key.length === 0) {
		throw new Error("Obfuscation key is empty.");
	}
	const output = new Uint8Array(input.length);
	for (let index = 0; index < input.length; index += 1) {
		output[index] = input[index]! ^ key[index % key.length]!;
	}
	return output;
}

function base64Encode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return window.btoa(binary);
}

function base64Decode(value: string): Uint8Array {
	const binary = window.atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function obfuscate(value: string): string {
	if (!value) {
		throw new Error("Cannot persist an empty management bearer.");
	}
	const encoded = xor(encoder.encode(value), keyBytes());
	const envelope = `${ENVELOPE_PREFIX}${base64Encode(encoded)}`;
	if (!envelope.startsWith(ENVELOPE_PREFIX) || envelope === value) {
		throw new Error("Management bearer obfuscation failed.");
	}
	return envelope;
}

export function deobfuscate(envelope: string): string {
	if (!envelope.startsWith(ENVELOPE_PREFIX)) {
		throw new Error("Stored management bearer is not obfuscated.");
	}
	const payload = envelope.slice(ENVELOPE_PREFIX.length);
	if (!payload) {
		throw new Error("Stored management bearer envelope is empty.");
	}
	return decoder.decode(xor(base64Decode(payload), keyBytes()));
}

export function saveRememberedBearer(bearer: string): boolean {
	try {
		const envelope = obfuscate(JSON.stringify({ bearer }));
		window.localStorage.setItem(STORAGE_KEY, envelope);
		const stored = window.localStorage.getItem(STORAGE_KEY) === envelope;
		if (!stored) {
			window.localStorage.removeItem(STORAGE_KEY);
		}
		return stored;
	} catch {
		// Private browsing and locked-down origins may reject local storage.
		// Never fall back to writing the bearer in another browser store.
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore cleanup failures.
		}
		return false;
	}
}

export function readRememberedBearer(): string | null {
	let envelope: string | null;
	try {
		envelope = window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
	if (envelope === null) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(deobfuscate(envelope));
		if (
			typeof parsed === "object"
			&& parsed !== null
			&& typeof (parsed as { bearer?: unknown }).bearer === "string"
			&& (parsed as { bearer: string }).bearer.length > 0
		) {
			return (parsed as { bearer: string }).bearer;
		}
	} catch {
		// A malformed or legacy plaintext value is never treated as a credential.
	}
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore storage cleanup failures; the value is still never used.
	}
	return null;
}

export function clearRememberedBearer(): void {
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore storage cleanup failures.
	}
}

export function rememberedBearerEnvelopePresent(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY)?.startsWith(ENVELOPE_PREFIX) === true;
	} catch {
		return false;
	}
}

export const rememberedBearerStorageKey = STORAGE_KEY;
