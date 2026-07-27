import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ManagementStatus } from "../lib/api";
import { formatUptime } from "../lib/format";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui";
import { ROUTES, routeDefinition, type RouteId } from "./routes";

const GROUPS = ["Operate", "Gateway", "Observe", "Control"] as const;

export function Shell({
	route,
	status,
	connected,
	children,
	onDisconnect,
	onRefresh,
}: {
	route: RouteId;
	status: ManagementStatus | null;
	connected: boolean;
	children: ReactNode;
	onDisconnect: () => void;
	onRefresh: () => void;
}) {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const definition = routeDefinition(route);

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
						'a[href], button:not([disabled])',
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

	const activateRoute = () => {
		setDrawerOpen(false);
		window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
	};

	return (
		<div className="console-shell" data-pi-router-ui="management-center operations-console">
			{drawerOpen ? (
				<button
					aria-label="Close navigation"
					className="nav-backdrop"
					onClick={closeDrawer}
					type="button"
				/>
			) : null}
			<aside
				aria-label="Primary navigation"
				className={`sidebar ${drawerOpen ? "is-open" : ""}`}
				id="primary-navigation"
			>
				<div className="brand">
					<div className="brand-symbol" aria-hidden="true">π</div>
					<div>
						<strong>Pi Router</strong>
						<span>Operations Console</span>
					</div>
					<button
						aria-label="Close navigation"
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
							<p>{group}</p>
							{ROUTES.filter((item) => item.group === group).map((item) => (
								<a
									aria-current={route === item.id ? "page" : undefined}
									className={route === item.id ? "active" : ""}
									href={`#${item.id}`}
									key={item.id}
									onClick={activateRoute}
								>
									<span className="nav-icon"><Icon name={item.icon} /></span>
									<span>
										<strong>{item.label}</strong>
										<small>{item.description}</small>
									</span>
								</a>
							))}
						</div>
					))}
				</nav>
				<div className="sidebar-footer">
					<div className={`connection-dot ${connected ? "is-connected" : ""}`} />
					<div>
						<strong>{connected ? status?.account.id ?? "Connected" : "Not connected"}</strong>
						<span>{connected ? "Bearer held in memory" : "Enter local bearer"}</span>
					</div>
				</div>
			</aside>

			<div className="console-workspace">
				<header className="topbar">
					<div className="topbar-leading">
						<button
							aria-controls="primary-navigation"
							aria-expanded={drawerOpen}
							aria-label="Open navigation"
							className="menu-button"
							onClick={() => setDrawerOpen(true)}
							ref={menuRef}
							type="button"
						>
							<Icon name="menu" />
						</button>
						<div className="breadcrumb">
							<span>{definition.group}</span>
							<Icon name="arrow" />
							<strong>{definition.label}</strong>
						</div>
					</div>
					<div className="topbar-actions">
						{connected && status ? (
							<div className="service-pill" title={`Uptime ${formatUptime(status.service.uptime_seconds)}`}>
								<span className="service-pulse" />
								<div>
									<strong>Service healthy</strong>
									<span>v{status.service.version} · {status.runtime.mode}</span>
								</div>
							</div>
						) : (
							<div className="service-pill is-offline">
								<span className="service-pulse" />
								<div>
									<strong>Console locked</strong>
									<span>Bearer required</span>
								</div>
							</div>
						)}
						{connected ? (
							<>
								<IconButton icon="refresh" label="Refresh service status" onClick={onRefresh} />
								<button className="disconnect-button" onClick={onDisconnect} type="button">
									<Icon name="logout" />
									<span>Disconnect</span>
								</button>
							</>
						) : null}
					</div>
				</header>
				<main id="main-content" className="page-content" tabIndex={-1}>
					{children}
				</main>
			</div>
		</div>
	);
}
