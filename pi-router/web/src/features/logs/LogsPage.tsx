import { useMemo, useState } from "react";

import {
	Badge,
	Button,
	Card,
	EmptyState,
	ErrorState,
	LoadingState,
	PageHeader,
	SearchField,
	SectionHeader,
} from "../../components/ui";
import { Icon } from "../../components/ui/Icon";
import type { ManagementClient } from "../../lib/api";
import { useQuery } from "../../lib/api/use-query";
import { formatDate, formatDuration } from "../../lib/format";

export function LogsPage({ client }: { client: ManagementClient }) {
	const query = useQuery("events", () => client.events(250));
	const [filter, setFilter] = useState("");
	const [level, setLevel] = useState<"all" | "success" | "errors">("all");
	const events = query.data ?? [];
	const visible = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return events.filter((event) => {
			const levelMatch = level === "all"
				|| (level === "success" && event.status < 400)
				|| (level === "errors" && event.status >= 400);
			const textMatch = !needle || [
				event.request_class,
				event.model,
				event.provider,
				event.error_code,
				String(event.status),
			].filter(Boolean).join(" ").toLowerCase().includes(needle);
			return levelMatch && textMatch;
		});
	}, [events, filter, level]);

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={query.refresh}>Refresh events</Button>}
				description="A bounded, newest-first operational buffer for this process—sanitized before data enters the console."
				eyebrow="Observe"
				title="Logs Viewer"
			/>
			<div className="log-boundary">
				<div><Icon name="shield" /></div>
				<p>
					<strong>What is retained:</strong> timestamp, request class, status, duration,
					model/provider identity, and bounded error code.
				</p>
				<p>
					<strong>What is excluded:</strong> headers, prompts, bodies, credentials,
					environment values, upstream responses, and filesystem paths.
				</p>
				<Badge tone="info">Memory only · 250 max</Badge>
			</div>
			<Card>
				<SectionHeader
					actions={
						<div className="log-controls">
							<SearchField
								label="Filter events"
								onChange={setFilter}
								placeholder="Filter class, model, provider, or code"
								value={filter}
							/>
							<label className="compact-select">
								<span className="visually-hidden">Filter by result</span>
								<select
									name="event_level"
									onChange={(event) => setLevel(event.target.value as typeof level)}
									value={level}
								>
									<option value="all">All results</option>
									<option value="success">Successful</option>
									<option value="errors">Errors only</option>
								</select>
							</label>
						</div>
					}
					description={`${visible.length} of ${events.length} retained events shown`}
					title="Operational events"
				/>
				{query.phase === "loading" ? <LoadingState label="Loading sanitized events…" /> : null}
				{query.phase === "error" ? (
					<ErrorState message={query.error} onRetry={query.refresh} />
				) : null}
				{query.phase === "ready" && events.length === 0 ? (
					<EmptyState
						description="New authenticated API and console activity will appear here for the lifetime of this process."
						icon="logs"
						title="No events retained yet"
					/>
				) : null}
				{query.phase === "ready" && events.length > 0 && visible.length === 0 ? (
					<EmptyState
						description="Clear the search or choose a broader result filter."
						icon="search"
						title="No events match"
					/>
				) : null}
				{query.phase === "ready" && visible.length > 0 ? (
					<div className="table-wrap">
						<table className="logs-table">
							<caption className="visually-hidden">Sanitized operational event log</caption>
							<thead>
								<tr>
									<th scope="col">Time</th>
									<th scope="col">Request class</th>
									<th scope="col">Result</th>
									<th scope="col">Duration</th>
									<th scope="col">Provider / model</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((event) => (
									<tr key={event.id}>
										<td data-label="Time">
											<time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time>
											<code className="event-id">{event.id}</code>
										</td>
										<td data-label="Request class">
											<strong>{event.request_class}</strong>
											{event.error_code ? <code className="error-code">{event.error_code}</code> : null}
										</td>
										<td data-label="Result">
											<Badge tone={event.status >= 400 ? "negative" : "positive"}>
												HTTP {event.status}
											</Badge>
										</td>
										<td data-label="Duration">{formatDuration(event.duration_ms)}</td>
										<td data-label="Provider / model">
											{event.model || event.provider ? (
												<div className="identity-stack">
													{event.provider ? <span>{event.provider}</span> : null}
													{event.model ? <code>{event.model}</code> : null}
												</div>
											) : <span className="muted">Not applicable</span>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</Card>
		</>
	);
}
