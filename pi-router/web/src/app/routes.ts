export type RouteId =
	| "dashboard"
	| "providers"
	| "auth-files"
	| "oauth"
	| "quota"
	| "logs"
	| "config"
	| "system";

export interface RouteDefinition {
	id: RouteId;
	path: string;
	labelKey: string;
	descriptionKey: string;
	group: "operate" | "gateway" | "observe" | "control";
	icon: "dashboard" | "providers" | "key" | "login" | "quota" | "logs" | "config" | "system";
}

export const ROUTES: RouteDefinition[] = [
	{
		id: "dashboard",
		path: "/dashboard",
		labelKey: "nav.dashboard",
		descriptionKey: "nav.dashboardMeta",
		group: "operate",
		icon: "dashboard",
	},
	{
		id: "providers",
		path: "/providers",
		labelKey: "nav.providers",
		descriptionKey: "nav.providersMeta",
		group: "gateway",
		icon: "providers",
	},
	{
		id: "auth-files",
		path: "/auth-files",
		labelKey: "nav.authFiles",
		descriptionKey: "nav.authFilesMeta",
		group: "gateway",
		icon: "key",
	},
	{
		id: "oauth",
		path: "/oauth",
		labelKey: "nav.oauth",
		descriptionKey: "nav.oauthMeta",
		group: "gateway",
		icon: "login",
	},
	{
		id: "quota",
		path: "/quota",
		labelKey: "nav.quota",
		descriptionKey: "nav.quotaMeta",
		group: "observe",
		icon: "quota",
	},
	{
		id: "logs",
		path: "/logs",
		labelKey: "nav.logs",
		descriptionKey: "nav.logsMeta",
		group: "observe",
		icon: "logs",
	},
	{
		id: "config",
		path: "/config",
		labelKey: "nav.config",
		descriptionKey: "nav.configMeta",
		group: "control",
		icon: "config",
	},
	{
		id: "system",
		path: "/system",
		labelKey: "nav.system",
		descriptionKey: "nav.systemMeta",
		group: "control",
		icon: "system",
	},
];

export function routeFromPath(pathname: string): RouteId {
	return ROUTES.find((route) => route.path === pathname)?.id ?? "dashboard";
}

export function routeDefinition(id: RouteId): RouteDefinition {
	return ROUTES.find((route) => route.id === id) ?? ROUTES[0]!;
}
