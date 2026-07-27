import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Badge,
	Button,
	Card,
	EmptyState,
	ErrorState,
	InlineNotice,
	LoadingState,
	PageHeader,
	SearchField,
	SectionHeader,
} from "../../components/ui";
import { Icon } from "../../components/ui/Icon";
import {
	errorMessage,
	type ManagementClient,
	type OperationalEvent,
} from "../../lib/api";
import { formatDate, formatDuration } from "../../lib/format";
import styles from "./LogsPage.module.scss";

const POLL_INTERVAL_MS = 2_500;

export function LogsPage({
	client,
	notify,
}: {
	client: ManagementClient;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const [events, setEvents] = useState<OperationalEvent[]>([]);
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("");
	const [level, setLevel] = useState<"all" | "success" | "errors">("all");
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [hideManagement, setHideManagement] = useState(true);
	const requestActive = useRef(false);
	const dismissedIds = useRef(new Set<string>());

	const load = useCallback(async (incremental = false) => {
		if (requestActive.current) {
			return;
		}
		requestActive.current = true;
		if (!incremental) {
			setPhase("loading");
		}
		try {
			const next = (await client.events(250))
				.filter((event) => !dismissedIds.current.has(event.id));
			setEvents((current) => {
				if (!incremental) {
					return next;
				}
				const merged = new Map(current.map((event) => [event.id, event]));
				for (const event of next) {
					merged.set(event.id, event);
				}
				return [...merged.values()]
					.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
					.slice(0, 250);
			});
			setError("");
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			if (!incremental) {
				setPhase("error");
			}
		} finally {
			requestActive.current = false;
		}
	}, [client]);

	useEffect(() => {
		void load(false);
	}, [load]);

	useEffect(() => {
		if (!autoRefresh) {
			return;
		}
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") {
				void load(true);
			}
		}, POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [autoRefresh, load]);

	const visible = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return events.filter((event) => {
			const levelMatch = level === "all"
				|| (level === "success" && event.status < 400)
				|| (level === "errors" && event.status >= 400);
			const managementMatch = !hideManagement
				|| !event.request_class.startsWith("management.");
			const textMatch = !needle || [
				event.request_class,
				event.model,
				event.provider,
				event.error_code,
				String(event.status),
			].filter(Boolean).join(" ").toLowerCase().includes(needle);
			return levelMatch && managementMatch && textMatch;
		});
	}, [events, filter, hideManagement, level]);

	const clearView = () => {
		for (const event of events) {
			dismissedIds.current.add(event.id);
		}
		setEvents([]);
		notify(t("logs.cleared"));
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={() => void load(false)}>{t("logs.refresh")}</Button>}
				description={t("logs.description")}
				eyebrow={t("logs.eyebrow")}
				title={t("logs.title")}
			/>
			<div className="log-boundary">
				<div><Icon name="shield" /></div>
				<p><strong>{t("logs.boundaryRetained")}</strong></p>
				<p><strong>{t("logs.boundaryExcluded")}</strong></p>
				<Badge tone="info">{t("logs.memoryOnly")}</Badge>
			</div>
			<Card>
				<SectionHeader
					actions={(
						<div className={styles.controls}>
							<SearchField
								label={t("logs.search")}
								onChange={setFilter}
								placeholder={t("logs.searchPlaceholder")}
								value={filter}
							/>
							<label className="compact-select">
								<span className="visually-hidden">{t("logs.result")}</span>
								<select
									name="event_level"
									onChange={(event) => setLevel(event.target.value as typeof level)}
									value={level}
								>
									<option value="all">{t("logs.allResults")}</option>
									<option value="success">{t("logs.successful")}</option>
									<option value="errors">{t("logs.errorsOnly")}</option>
								</select>
							</label>
							<label className={styles.toggle}>
								<input
									checked={hideManagement}
									onChange={(event) => setHideManagement(event.target.checked)}
									type="checkbox"
								/>
								{t("logs.hideManagement")}
							</label>
							<label className={styles.toggle}>
								<input
									checked={autoRefresh}
									onChange={(event) => setAutoRefresh(event.target.checked)}
									type="checkbox"
								/>
								{t("logs.autoRefresh")}
							</label>
							<Button disabled={events.length === 0} onClick={clearView} size="compact">
								{t("logs.clearView")}
							</Button>
						</div>
					)}
					description={t("logs.showing", { visible: visible.length, total: events.length })}
					title={t("logs.events")}
				/>
				{phase === "loading" ? <LoadingState label={t("logs.loading")} /> : null}
				{phase === "error" ? <ErrorState message={error} onRetry={() => void load(false)} /> : null}
				{phase === "ready" && error ? (
					<InlineNotice tone="negative">{error}</InlineNotice>
				) : null}
				{phase === "ready" && events.length === 0 ? (
					<EmptyState
						description={t("logs.emptyBody")}
						icon="logs"
						title={t("logs.empty")}
					/>
				) : null}
				{phase === "ready" && events.length > 0 && visible.length === 0 ? (
					<EmptyState
						description={t("logs.noMatchBody")}
						icon="search"
						title={t("logs.noMatch")}
					/>
				) : null}
				{phase === "ready" && visible.length > 0 ? (
					<div className="table-wrap">
						<table className="logs-table">
							<caption className="visually-hidden">{t("logs.events")}</caption>
							<thead>
								<tr>
									<th scope="col">{t("logs.time")}</th>
									<th scope="col">{t("logs.requestClass")}</th>
									<th scope="col">{t("logs.result")}</th>
									<th scope="col">{t("logs.duration")}</th>
									<th scope="col">{t("logs.identity")}</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((event) => (
									<tr key={event.id}>
										<td data-label={t("logs.time")}>
											<time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time>
											<code className="event-id">{event.id}</code>
										</td>
										<td data-label={t("logs.requestClass")}>
											<strong>{event.request_class}</strong>
											{event.error_code ? <code className="error-code">{event.error_code}</code> : null}
										</td>
										<td data-label={t("logs.result")}>
											<Badge tone={event.status >= 400 ? "negative" : "positive"}>
												HTTP {event.status}
											</Badge>
										</td>
										<td data-label={t("logs.duration")}>{formatDuration(event.duration_ms)}</td>
										<td data-label={t("logs.identity")}>
											{event.model || event.provider ? (
												<div className="identity-stack">
													{event.provider ? <span>{event.provider}</span> : null}
													{event.model ? <code>{event.model}</code> : null}
												</div>
											) : <span className="muted">{t("logs.notApplicable")}</span>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</Card>
			<Card>
				<div className={styles.capability}>
					<div>
						<SectionHeader title={t("logs.fileActions")} />
						<p>{t("logs.fileActionsUnavailable")}</p>
					</div>
					<Button disabled>{t("common.unsupported")}</Button>
				</div>
			</Card>
		</>
	);
}
