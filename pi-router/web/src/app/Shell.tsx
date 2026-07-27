import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { IconButton } from "../components/ui";
import { Icon } from "../components/ui/Icon";
import type { ManagementStatus } from "../lib/api";
import { formatUptime } from "../lib/format";
import {
	usePreferenceStore,
	type Language,
	type Theme,
} from "../stores/preferences";
import { ROUTES, routeDefinition, type RouteId } from "./routes";
import styles from "./Shell.module.scss";

const GROUPS = ["operate", "gateway", "observe", "control"] as const;

export function Shell({
	route,
	status,
	children,
	onDisconnect,
	onRefresh,
	onBeforeNavigate,
}: {
	route: RouteId;
	status: ManagementStatus;
	children: ReactNode;
	onDisconnect: () => void;
	onRefresh: () => void;
	onBeforeNavigate: () => boolean;
}) {
	const { t } = useTranslation();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const definition = routeDefinition(route);
	const theme = usePreferenceStore((state) => state.theme);
	const language = usePreferenceStore((state) => state.language);
	const setTheme = usePreferenceStore((state) => state.setTheme);
	const setLanguage = usePreferenceStore((state) => state.setLanguage);
	const healthy = status.service.status === "ok"
		&& status.connection.status === "connected";

	useEffect(() => {
		if (!drawerOpen) {
			return;
		}
		closeRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setDrawerOpen(false);
				menuRef.current?.focus();
			}
			if (event.key === "Tab") {
				const sidebar = document.getElementById("primary-navigation");
				const focusable = sidebar
					? [...sidebar.querySelectorAll<HTMLElement>(
						'a[href], button:not([disabled]), select:not([disabled])',
					)]
					: [];
				if (focusable.length === 0) {
					return;
				}
				const index = focusable.indexOf(document.activeElement as HTMLElement);
				const next = event.shiftKey
					? (index <= 0 ? focusable.length - 1 : index - 1)
					: (index >= focusable.length - 1 ? 0 : index + 1);
				event.preventDefault();
				focusable[next]?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [drawerOpen]);

	const closeDrawer = () => {
		setDrawerOpen(false);
		menuRef.current?.focus();
	};

	const activateRoute = (event: MouseEvent<HTMLAnchorElement>) => {
		if (!onBeforeNavigate()) {
			event.preventDefault();
			return;
		}
		setDrawerOpen(false);
		window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
	};

	return (
		<div className="console-shell" data-pi-router-ui="management-center operations-console">
			{drawerOpen ? (
				<button
					aria-label={t("app.closeNavigation")}
					className="nav-backdrop"
					onClick={closeDrawer}
					type="button"
				/>
			) : null}
			<aside
				aria-label={t("app.primaryNavigation")}
				className={`sidebar ${drawerOpen ? "is-open" : ""}`}
				id="primary-navigation"
			>
				<div className="brand">
					<div className="brand-symbol" aria-hidden="true">π</div>
					<div>
						<strong>{t("app.brand")}</strong>
						<span>{t("app.operationsConsole")}</span>
					</div>
					<button
						aria-label={t("app.closeNavigation")}
						className="drawer-close"
						onClick={closeDrawer}
						ref={closeRef}
						type="button"
					>
						<Icon name="close" />
					</button>
				</div>
				<nav>
					{GROUPS.map((group) => (
						<div className="nav-group" key={group}>
							<p>{t(`groups.${group}`)}</p>
							{ROUTES.filter((item) => item.group === group).map((item) => (
								<NavLink
									className={({ isActive }) => isActive ? "active" : ""}
									key={item.id}
									onClick={activateRoute}
									to={item.path}
								>
									<span className="nav-icon"><Icon name={item.icon} /></span>
									<span>
										<strong>{t(item.labelKey)}</strong>
										<small>{t(item.descriptionKey)}</small>
									</span>
								</NavLink>
							))}
						</div>
					))}
				</nav>
				<div className="sidebar-footer">
					<div className={`connection-dot ${healthy ? "is-connected" : "is-error"}`} />
					<div>
						<strong>{status.account.id}</strong>
						<span>{t("app.bearerInMemory")}</span>
					</div>
				</div>
			</aside>

			<div className="console-workspace">
				<header className="topbar">
					<div className="topbar-leading">
						<button
							aria-controls="primary-navigation"
							aria-expanded={drawerOpen}
							aria-label={t("app.openNavigation")}
							className="menu-button"
							onClick={() => setDrawerOpen(true)}
							ref={menuRef}
							type="button"
						>
							<Icon name="menu" />
						</button>
						<div className="breadcrumb">
							<span>{t(`groups.${definition.group}`)}</span>
							<Icon name="arrow" />
							<strong>{t(definition.labelKey)}</strong>
						</div>
					</div>
					<div className="topbar-actions">
						<div
							className={`service-pill ${healthy ? "" : "is-offline"}`}
							title={t("app.uptimeLabel", {
								uptime: formatUptime(status.service.uptime_seconds),
							})}
						>
							<span className="service-pulse" />
							<div>
								<strong>{t(healthy ? "app.serviceHealthy" : "app.serviceUnavailable")}</strong>
								<span>v{status.service.version} · {status.runtime.mode}</span>
							</div>
						</div>
						<div className={styles.preferences}>
							<select
								aria-label={t("app.language")}
								className={styles.select}
								onChange={(event) => setLanguage(event.target.value as Language)}
								value={language}
							>
								<option value="vi">VI</option>
								<option value="en">EN</option>
							</select>
							<select
								aria-label={t("app.theme")}
								className={styles.select}
								onChange={(event) => setTheme(event.target.value as Theme)}
								value={theme}
							>
								<option value="system">{t("app.themeSystem")}</option>
								<option value="light">{t("app.themeLight")}</option>
								<option value="dark">{t("app.themeDark")}</option>
							</select>
						</div>
						<IconButton
							icon="refresh"
							label={t("app.refreshStatus")}
							onClick={onRefresh}
						/>
						<button className="disconnect-button" onClick={onDisconnect} type="button">
							<Icon name="logout" />
							<span>{t("app.disconnect")}</span>
						</button>
					</div>
				</header>
				<main id="main-content" className="page-content" tabIndex={-1}>
					{children}
				</main>
			</div>
		</div>
	);
}
