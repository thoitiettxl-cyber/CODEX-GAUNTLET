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
import type { ManagementClient, ProviderInfo } from "../../lib/api";
import { useQuery } from "../../lib/api/use-query";
import { formatNumber } from "../../lib/format";

function providerTone(state: ProviderInfo["state"]) {
	if (state === "available") {
		return "positive" as const;
	}
	if (state === "error") {
		return "negative" as const;
	}
	if (state === "configured") {
		return "warning" as const;
	}
	return "neutral" as const;
}

export function ProvidersPage({ client }: { client: ManagementClient }) {
	const [filter, setFilter] = useState("");
	const query = useQuery("providers", () => client.providers());
	const providers = query.data ?? [];
	const visible = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return needle
			? providers.filter((provider) =>
				`${provider.name} ${provider.id}`.toLowerCase().includes(needle))
			: providers;
	}, [filter, providers]);
	const configured = providers.filter((provider) => provider.configured).length;
	const availableModels = providers.reduce(
		(total, provider) => total + provider.available_model_count,
		0,
	);

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={query.refresh}>Refresh inventory</Button>}
				description="Registered provider capabilities, authentication posture, and model availability from the pinned Pi runtime."
				eyebrow="Gateway"
				title="AI Providers"
			/>
			<div className="summary-strip">
				<div><span>Registered</span><strong>{formatNumber(providers.length)}</strong></div>
				<div><span>Configured</span><strong>{formatNumber(configured)}</strong></div>
				<div><span>Available models</span><strong>{formatNumber(availableModels)}</strong></div>
				<div>
					<span>Inventory state</span>
					<Badge tone={providers.some((provider) => provider.state === "error") ? "warning" : "positive"}>
						{providers.some((provider) => provider.state === "error") ? "Needs review" : "Operational"}
					</Badge>
				</div>
			</div>

			<Card>
				<SectionHeader
					actions={
						<SearchField
							label="Filter providers"
							onChange={setFilter}
							placeholder="Filter by provider name or id"
							value={filter}
						/>
					}
					description="Model totals include the known catalog; available totals require configured authentication."
					title="Provider inventory"
				/>
				{query.phase === "loading" ? <LoadingState label="Loading providers…" /> : null}
				{query.phase === "error" ? (
					<ErrorState message={query.error} onRetry={query.refresh} />
				) : null}
				{query.phase === "ready" && providers.length === 0 ? (
					<EmptyState
						action={<a className="text-link" href="#config">Open Config Panel <Icon name="arrow" /></a>}
						description="Built-in or custom providers will appear after the runtime registers them."
						icon="providers"
						title="No providers registered"
					/>
				) : null}
				{query.phase === "ready" && providers.length > 0 && visible.length === 0 ? (
					<EmptyState
						description="Clear or broaden the filter to see the provider inventory."
						icon="search"
						title="No providers match"
					/>
				) : null}
				{query.phase === "ready" && visible.length > 0 ? (
					<div className="table-wrap">
						<table>
							<caption className="visually-hidden">AI provider inventory</caption>
							<thead>
								<tr>
									<th scope="col">Provider</th>
									<th scope="col">State</th>
									<th scope="col">Authentication</th>
									<th scope="col">Models</th>
									<th scope="col"><span className="visually-hidden">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{visible.map((provider) => (
									<tr key={provider.id}>
										<td data-label="Provider">
											<div className="provider-cell">
												<span className="provider-avatar">{provider.name.slice(0, 2).toUpperCase()}</span>
												<div>
													<strong>{provider.name}</strong>
													<code>{provider.id}</code>
												</div>
											</div>
										</td>
										<td data-label="State">
											<Badge tone={providerTone(provider.state)}>{provider.state}</Badge>
											{provider.configured_source ? (
												<small className="cell-detail">{provider.configured_source}</small>
											) : null}
										</td>
										<td data-label="Authentication">
											<div className="badge-row">
												{provider.auth_modes.map((mode) => (
													<Badge key={mode.type} tone={mode.login_supported ? "info" : "neutral"}>
														{mode.type === "api_key" ? "API key" : "OAuth"}
													</Badge>
												))}
											</div>
											<small className="cell-detail">
												{provider.credential_type
													? `${provider.credential_type === "api_key" ? "API key" : "OAuth"} stored`
													: "No stored credential metadata"}
											</small>
										</td>
										<td data-label="Models">
											<strong>{provider.available_model_count}</strong>
											<span className="muted"> available / {provider.model_count} known</span>
										</td>
										<td className="table-action">
											<a
												aria-label={`Authenticate ${provider.name}`}
												className="row-action"
												href="#oauth"
											>
												<span>{provider.configured ? "Replace login" : "Set up"}</span>
												<Icon name="arrow" />
											</a>
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
