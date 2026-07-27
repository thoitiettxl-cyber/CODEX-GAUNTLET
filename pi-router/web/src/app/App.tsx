import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectionGate } from "./ConnectionGate";
import { Shell } from "./Shell";
import { routeDefinition, routeFromHash, type RouteId } from "./routes";
import { AuthFilesPage } from "../features/auth-files/AuthFilesPage";
import { ConfigPage } from "../features/config/ConfigPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LogsPage } from "../features/logs/LogsPage";
import { OAuthPage } from "../features/oauth/OAuthPage";
import { ProvidersPage } from "../features/providers/ProvidersPage";
import { QuotaPage } from "../features/quota/QuotaPage";
import {
	errorMessage,
	ManagementClient,
	type ManagementStatus,
} from "../lib/api";
import { Icon } from "../components/ui/Icon";

interface Notice {
	id: number;
	message: string;
	tone: "positive" | "negative";
}

export function App() {
	const [route, setRoute] = useState<RouteId>(() => routeFromHash(window.location.hash));
	const [bearerDraft, setBearerDraft] = useState("");
	const [client, setClient] = useState<ManagementClient | null>(null);
	const [status, setStatus] = useState<ManagementStatus | null>(null);
	const [connectionPhase, setConnectionPhase] = useState<"idle" | "checking" | "error">("idle");
	const [connectionError, setConnectionError] = useState("");
	const [dirtyConfig, setDirtyConfig] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);

	const notify = useCallback((message: string, tone: "positive" | "negative" = "positive") => {
		setNotice({ id: Date.now(), message, tone });
	}, []);

	useEffect(() => {
		if (!notice) {
			return;
		}
		const timer = window.setTimeout(() => setNotice(null), 4200);
		return () => window.clearTimeout(timer);
	}, [notice]);

	useEffect(() => {
		if (!window.location.hash) {
			window.history.replaceState(null, "", "#dashboard");
		}
		const onHashChange = () => {
			const next = routeFromHash(window.location.hash);
			if (
				dirtyConfig
				&& route === "config"
				&& next !== "config"
				&& !window.confirm("Discard the unsaved configuration draft and leave Config Panel?")
			) {
				window.history.replaceState(null, "", "#config");
				return;
			}
			setRoute(next);
		};
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [dirtyConfig, route]);

	useEffect(() => {
		document.title = `${routeDefinition(route).label} · Pi Router`;
	}, [route]);

	const refreshStatus = useCallback(async () => {
		if (!client) {
			return;
		}
		try {
			setStatus(await client.status());
		} catch (error) {
			notify(errorMessage(error), "negative");
		}
	}, [client, notify]);

	const connect = async () => {
		if (!bearerDraft.trim()) {
			return;
		}
		setConnectionPhase("checking");
		setConnectionError("");
		const nextClient = new ManagementClient(bearerDraft);
		try {
			const nextStatus = await nextClient.status();
			setClient(nextClient);
			setStatus(nextStatus);
			setBearerDraft("");
			setConnectionPhase("idle");
		} catch (error) {
			setConnectionError(errorMessage(error));
			setConnectionPhase("error");
		}
	};

	const disconnect = () => {
		if (dirtyConfig && !window.confirm("Discard the unsaved configuration draft and disconnect?")) {
			return;
		}
		setClient(null);
		setStatus(null);
		setBearerDraft("");
		setConnectionError("");
		setConnectionPhase("idle");
		setDirtyConfig(false);
		setNotice(null);
	};

	const page = useMemo(() => {
		if (!client || !status) {
			return (
				<ConnectionGate
					error={connectionError}
					onChange={setBearerDraft}
					onConnect={() => void connect()}
					phase={connectionPhase}
					value={bearerDraft}
				/>
			);
		}
		switch (route) {
			case "providers":
				return (
					<ProvidersPage
						client={client}
						notify={notify}
						onMutation={refreshStatus}
					/>
				);
			case "auth-files":
				return (
					<AuthFilesPage
						client={client}
						notify={notify}
						onMutation={refreshStatus}
					/>
				);
			case "oauth":
				return (
					<OAuthPage
						activeAccountId={status.account.id}
						client={client}
						notify={notify}
						onMutation={refreshStatus}
					/>
				);
			case "quota":
				return <QuotaPage client={client} />;
			case "logs":
				return <LogsPage client={client} />;
			case "config":
				return (
					<ConfigPage
						client={client}
						notify={notify}
						onDirtyChange={setDirtyConfig}
						onMutation={refreshStatus}
					/>
				);
			case "dashboard":
			default:
				return (
					<DashboardPage
						client={client}
						notify={notify}
						onRefreshStatus={refreshStatus}
						status={status}
					/>
				);
		}
	}, [
		bearerDraft,
		client,
		connectionError,
		connectionPhase,
		notify,
		refreshStatus,
		route,
		status,
	]);

	return (
		<Shell
			connected={client !== null}
			onDisconnect={disconnect}
			onRefresh={() => void refreshStatus()}
			route={route}
			status={status}
		>
			{page}
			{notice ? (
				<div
					className={`toast toast-${notice.tone}`}
					key={notice.id}
					role={notice.tone === "negative" ? "alert" : "status"}
				>
					<Icon name={notice.tone === "negative" ? "warning" : "check"} />
					<span>{notice.message}</span>
					<button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button">
						<Icon name="close" />
					</button>
				</div>
			) : null}
		</Shell>
	);
}
