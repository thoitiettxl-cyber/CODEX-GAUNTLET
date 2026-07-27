export function cspNonce(): string {
	return document
		.querySelector<HTMLMetaElement>('meta[name="pi-router-csp-nonce"]')
		?.content
		.trim() ?? "";
}
