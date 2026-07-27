export type RouteId =
	| "dashboard"
	| "providers"
	| "auth-files"
	| "oauth"
	| "quota"
	| "logs"
	| "config";

export interface RouteDefinition {
	id: RouteId;
	label: string;
	description: string;
	group: "Operate" | "Gateway" | "Observe" | "Control";
	icon: "dashboard" | "providers" | "key" | "login" | "quota" | "logs" | "config";
}

export const ROUTES: RouteDefinition[] = [
	{
		id: "dashboard",
		label: "Dashboard",
		description: "Service posture",
		group: "Operate",
		icon: "dashboard",
	},
	{
		id: "providers",
		label: "AI Providers",
		description: "Runtime inventory",
		group: "Gateway",
		icon: "providers",
	},
	{
		id: "auth-files",
		label: "Auth Files",
		description: "Credential metadata",
		group: "Gateway",
		icon: "key",
	},
	{
		id: "oauth",
		label: "OAuth Login",
		description: "Provider sign-in",
		group: "Gateway",
		icon: "login",
	},
	{
		id: "quota",
		label: "Quota Management",
		description: "Provider capacity",
		group: "Observe",
		icon: "quota",
	},
	{
		id: "logs",
		label: "Logs Viewer",
		description: "Sanitized events",
		group: "Observe",
		icon: "logs",
	},
	{
		id: "config",
		label: "Config Panel",
		description: "Validated models",
		group: "Control",
		icon: "config",
	},
];

export function routeFromHash(hash: string): RouteId {
	const candidate = hash.replace(/^#\/?/u, "");
	return ROUTES.some((route) => route.id === candidate)
		? candidate as RouteId
		: "dashboard";
}

export function routeDefinition(id: RouteId): RouteDefinition {
	return ROUTES.find((route) => route.id === id) ?? ROUTES[0]!;
}
