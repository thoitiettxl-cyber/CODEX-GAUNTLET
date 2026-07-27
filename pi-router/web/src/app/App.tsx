import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	HashRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";

import { Icon } from "../components/ui/Icon";
import { AuthFilesPage } from "../features/auth-files/AuthFilesPage";
import { ConfigPage } from "../features/config/ConfigPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LogsPage } from "../features/logs/LogsPage";
import { OAuthPage } from "../features/oauth/OAuthPage";
import { ProvidersPage } from "../features/providers/ProvidersPage";
import { QuotaPage } from "../features/quota/QuotaPage";
import { SystemPage } from "../features/system/SystemPage";
import { useAuthStore } from "../stores/auth";
import { usePreferenceStore } from "../stores/preferences";
import { ConnectionGate } from "./ConnectionGate";
import { routeDefinition, routeFromPath } from "./routes";
import { Shell } from "./Shell";
import styles from "./App.module.scss";

interface Notice {
	id: number;
	message: string;
	tone: "positive" | "negative";
}

function Console() {
	const { t } = useTranslation();
	const location = useLocation();
	const phase = useAuthStore((state) => state.phase);
	const bearerDraft = useAuthStore((state) => state.bearerDraft);
	const remember = useAuthStore((state) => state.remember);
	const client = useAuthStore((state) => state.client);
	const status = useAuthStore((state) => state.status);
	const connectionError = useAuthStore((state) => state.error);
	const initialized = useAuthStore((state) => state.initialized);
	const setBearerDraft = useAuthStore((state) => state.setBearerDraft);
	const setRemember = useAuthStore((state) => state.setRemember);
	const initializeAuth = useAuthStore((state) => state.initialize);
	const connect = useAuthStore((state) => state.connect);
	const refreshStatus = useAuthStore((state) => state.refreshStatus);
	const disconnectStore = useAuthStore((state) => state.disconnect);
	const initializePreferences = usePreferenceStore((state) => state.initialize);
	const [dirtyConfig, setDirtyConfig] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);
	const route = routeFromPath(location.pathname);

	const notify = useCallback(
		(message: string, tone: "positive" | "negative" = "positive") => {
			setNotice({ id: Date.now(), message, tone });
		},
		[],
	);

	useEffect(() => initializePreferences(), [initializePreferences]);
	useEffect(() => {
		void initializeAuth();
	}, [initializeAuth]);
	useEffect(() => {
		const skip = document.querySelector<HTMLAnchorElement>(".skip-link");
		if (skip) {
			skip.textContent = t("app.skip");
		}
		document.title = `${t(routeDefinition(route).labelKey)} · Pi Router`;
	}, [route, t]);
	useEffect(() => {
		if (!notice) {
			return;
		}
		const timer = window.setTimeout(() => setNotice(null), 4200);
		return () => window.clearTimeout(timer);
	}, [notice]);

	const canLeaveConfig = useCallback(() => (
		!dirtyConfig || window.confirm(t("app.discardConfig"))
	), [dirtyConfig, t]);

	const disconnect = () => {
		if (!canLeaveConfig()) {
			return;
		}
		setDirtyConfig(false);
		setNotice(null);
		disconnectStore();
	};

	const refresh = async () => {
		try {
			await refreshStatus();
		} catch (error) {
			notify(error instanceof Error ? error.message : t("common.error"), "negative");
		}
	};

	if (!initialized) {
		return (
			<div className={styles.boot} aria-live="polite">
				<span className="spinner" aria-hidden="true" />
				<span>{t("app.loadingConsole")}</span>
			</div>
		);
	}

	if (!client || !status || phase !== "connected") {
		return (
			<ConnectionGate
				error={connectionError}
				onChange={setBearerDraft}
				onConnect={() => void connect()}
				onRememberChange={setRemember}
				phase={phase === "checking" ? "checking" : phase === "error" ? "error" : "idle"}
				remember={remember}
				value={bearerDraft}
			/>
		);
	}

	return (
		<Shell
			onBeforeNavigate={canLeaveConfig}
			onDisconnect={disconnect}
			onRefresh={() => void refresh()}
			route={route}
			status={status}
		>
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					animate={{ opacity: 1, y: 0 }}
					className={styles.page}
					exit={{ opacity: 0, y: -6 }}
					initial={{ opacity: 0, y: 6 }}
					key={location.pathname}
					transition={{ duration: 0.16, ease: "easeOut" }}
				>
					<Routes location={location}>
						<Route
							path="/dashboard"
							element={(
								<DashboardPage
									client={client}
									notify={notify}
									onRefreshStatus={refreshStatus}
									status={status}
								/>
							)}
						/>
						<Route
							path="/providers"
							element={(
								<ProvidersPage
									client={client}
									notify={notify}
									onMutation={refreshStatus}
								/>
							)}
						/>
						<Route
							path="/auth-files"
							element={(
								<AuthFilesPage
									client={client}
									notify={notify}
									onMutation={refreshStatus}
								/>
							)}
						/>
						<Route
							path="/oauth"
							element={(
								<OAuthPage
									activeAccountId={status.account.id}
									client={client}
									notify={notify}
									onMutation={refreshStatus}
								/>
							)}
						/>
						<Route path="/quota" element={<QuotaPage client={client} />} />
						<Route path="/logs" element={<LogsPage client={client} notify={notify} />} />
						<Route
							path="/config"
							element={(
								<ConfigPage
									client={client}
									notify={notify}
									onDirtyChange={setDirtyConfig}
									onMutation={refreshStatus}
								/>
							)}
						/>
						<Route
							path="/system"
							element={(
								<SystemPage
									client={client}
									notify={notify}
									status={status}
								/>
							)}
						/>
						<Route path="/" element={<Navigate replace to="/dashboard" />} />
						<Route path="*" element={<Navigate replace to="/dashboard" />} />
					</Routes>
				</motion.div>
			</AnimatePresence>
			{notice ? (
				<div
					className={`toast toast-${notice.tone}`}
					key={notice.id}
					role={notice.tone === "negative" ? "alert" : "status"}
				>
					<Icon name={notice.tone === "negative" ? "warning" : "check"} />
					<span>{notice.message}</span>
					<button
						aria-label={t("app.dismissNotification")}
						onClick={() => setNotice(null)}
						type="button"
					>
						<Icon name="close" />
					</button>
				</div>
			) : null}
		</Shell>
	);
}

export function App() {
	return (
		<HashRouter>
			<MotionConfig reducedMotion="user">
				<Console />
			</MotionConfig>
		</HashRouter>
	);
}
