import { useMemo, useState, type FormEvent } from "react";

import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
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
	type ProviderInfo,
} from "../../lib/api";
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

interface CustomProviderDraft {
	id: string;
	name: string;
	baseUrl: string;
	api: "openai-responses" | "openai-completions";
	modelId: string;
	modelAlias: string;
	proxyUrl: string;
	headers: string;
	excludedModels: string;
}

const EMPTY_CUSTOM: CustomProviderDraft = {
	id: "",
	name: "",
	baseUrl: "",
	api: "openai-responses",
	modelId: "",
	modelAlias: "",
	proxyUrl: "",
	headers: "{}",
	excludedModels: "",
};

export function ProvidersPage({
	client,
	onMutation,
	notify,
}: {
	client: ManagementClient;
	onMutation: () => Promise<void>;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const [filter, setFilter] = useState("");
	const [custom, setCustom] = useState<CustomProviderDraft>(EMPTY_CUSTOM);
	const [customError, setCustomError] = useState("");
	const [customBusy, setCustomBusy] = useState(false);
	const [pendingCustom, setPendingCustom] = useState<{
		document: Record<string, unknown>;
		revision: string;
		providerId: string;
	} | null>(null);
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

	const updateCustom = <K extends keyof CustomProviderDraft>(
		key: K,
		value: CustomProviderDraft[K],
	) => setCustom((current) => ({ ...current, [key]: value }));

	const previewCustom = async (event: FormEvent) => {
		event.preventDefault();
		setCustomBusy(true);
		setCustomError("");
		try {
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(custom.id)) {
				throw new Error("Provider id may contain only letters, numbers, dot, underscore, or hyphen.");
			}
			const headers = JSON.parse(custom.headers) as unknown;
			if (
				typeof headers !== "object"
				|| headers === null
				|| Array.isArray(headers)
				|| Object.values(headers).some((value) => typeof value !== "string")
			) {
				throw new Error("Headers must be a JSON object whose values are strings.");
			}
			const config = await client.getConfig();
			if (!config.editable || !config.document) {
				throw new Error("Provider configuration is not currently editable.");
			}
			const document = structuredClone(config.document);
			const providerMap = (
				typeof document.providers === "object"
				&& document.providers !== null
				&& !Array.isArray(document.providers)
			) ? document.providers as Record<string, unknown> : {};
			if (providerMap[custom.id]) {
				throw new Error("That provider id already exists. Edit it in Config Panel.");
			}
			const excludedModels = custom.excludedModels
				.split(/\r?\n|,/u)
				.map((value) => value.trim())
				.filter(Boolean);
			providerMap[custom.id] = {
				name: custom.name.trim() || custom.id,
				baseUrl: custom.baseUrl.trim(),
				api: custom.api,
				authHeader: true,
				...(Object.keys(headers).length > 0 ? { headers } : {}),
				models: [{
					id: custom.modelId.trim(),
					name: custom.modelId.trim(),
				}],
				...(custom.proxyUrl.trim() ? { proxyUrl: custom.proxyUrl.trim() } : {}),
				...(custom.modelAlias.trim()
					? { modelAliases: { [custom.modelId.trim()]: custom.modelAlias.trim() } }
					: {}),
				...(excludedModels.length > 0 ? { excludedModels } : {}),
			};
			document.providers = providerMap;
			const preview = await client.previewConfig(document);
			if (!preview.valid || !preview.revision) {
				throw new Error(
					preview.errors.map((item) => `${item.path}: ${item.message}`).join(" · ")
						|| "Provider configuration did not pass validation.",
				);
			}
			setPendingCustom({
				document,
				revision: preview.revision,
				providerId: custom.id,
			});
		} catch (error) {
			setCustomError(errorMessage(error));
		} finally {
			setCustomBusy(false);
		}
	};

	const applyCustom = async () => {
		if (!pendingCustom) {
			return;
		}
		setCustomBusy(true);
		try {
			await client.applyConfig(pendingCustom.document, pendingCustom.revision);
			notify(`Custom provider ${pendingCustom.providerId} added and reloaded.`);
			setCustom(EMPTY_CUSTOM);
			setPendingCustom(null);
			await Promise.all([query.refresh(), onMutation()]);
		} catch (error) {
			setCustomError(errorMessage(error));
			setPendingCustom(null);
		} finally {
			setCustomBusy(false);
		}
	};

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
					actions={<a className="text-link" href="#config">Advanced JSON editor <Icon name="arrow" /></a>}
					description="Add any safe provider id using an OpenAI-compatible protocol. Authentication is added separately through OAuth Login."
					title="Custom OpenAI-compatible provider"
				/>
				<InlineNotice>
					Base URL, non-secret headers, provider proxy, alias, and exclusions are validated
					before apply. API-key values and credential-bearing headers are intentionally not accepted here.
				</InlineNotice>
				{customError ? <InlineNotice tone="negative">{customError}</InlineNotice> : null}
				<form className="custom-provider-form" onSubmit={(event) => void previewCustom(event)}>
					<label className="field">
						<span>Provider id</span>
						<input
							maxLength={64}
							name="custom_provider_id"
							onChange={(event) => updateCustom("id", event.target.value)}
							placeholder="my-openai-provider"
							required
							value={custom.id}
						/>
					</label>
					<label className="field">
						<span>Display name</span>
						<input
							maxLength={160}
							name="custom_provider_name"
							onChange={(event) => updateCustom("name", event.target.value)}
							placeholder="My OpenAI provider"
							value={custom.name}
						/>
					</label>
					<label className="field field-wide">
						<span>Base URL</span>
						<input
							name="custom_provider_base_url"
							onChange={(event) => updateCustom("baseUrl", event.target.value)}
							placeholder="https://api.example.com/v1"
							required
							type="url"
							value={custom.baseUrl}
						/>
					</label>
					<label className="field">
						<span>Protocol</span>
						<select
							name="custom_provider_api"
							onChange={(event) => updateCustom(
								"api",
								event.target.value as CustomProviderDraft["api"],
							)}
							value={custom.api}
						>
							<option value="openai-responses">OpenAI Responses</option>
							<option value="openai-completions">OpenAI Chat Completions</option>
						</select>
					</label>
					<label className="field">
						<span>Upstream model id</span>
						<input
							maxLength={160}
							name="custom_provider_model"
							onChange={(event) => updateCustom("modelId", event.target.value)}
							placeholder="gpt-compatible-model"
							required
							value={custom.modelId}
						/>
					</label>
					<label className="field">
						<span>Model alias <small>(optional)</small></span>
						<input
							maxLength={160}
							name="custom_provider_alias"
							onChange={(event) => updateCustom("modelAlias", event.target.value)}
							placeholder="fast"
							value={custom.modelAlias}
						/>
					</label>
					<label className="field">
						<span>Provider proxy URL <small>(optional)</small></span>
						<input
							name="custom_provider_proxy"
							onChange={(event) => updateCustom("proxyUrl", event.target.value)}
							placeholder="http://127.0.0.1:8080"
							type="url"
							value={custom.proxyUrl}
						/>
					</label>
					<label className="field">
						<span>Non-secret headers JSON</span>
						<textarea
							name="custom_provider_headers"
							onChange={(event) => updateCustom("headers", event.target.value)}
							spellCheck={false}
							value={custom.headers}
						/>
					</label>
					<label className="field">
						<span>Excluded model patterns</span>
						<textarea
							name="custom_provider_exclusions"
							onChange={(event) => updateCustom("excludedModels", event.target.value)}
							placeholder={"legacy-*\n*-preview"}
							spellCheck={false}
							value={custom.excludedModels}
						/>
					</label>
					<div className="field-wide button-row">
						<Button
							disabled={
								customBusy
								|| !custom.id.trim()
								|| !custom.baseUrl.trim()
								|| !custom.modelId.trim()
							}
							icon="shield"
							type="submit"
							variant="primary"
						>
							{customBusy ? "Validating…" : "Validate provider"}
						</Button>
					</div>
				</form>
			</Card>

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
												{provider.credential_count > 0
													? `${provider.credential_count} credential${provider.credential_count === 1 ? "" : "s"} stored`
													: "No stored credential metadata"}
											</small>
											{provider.configuration_required ? (
												<small className="cell-detail">
													Requires <code>{provider.configuration_required}</code>
												</small>
											) : null}
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
			<ConfirmDialog
				busy={customBusy}
				confirmLabel="Add custom provider"
				description={`Apply the validated ${pendingCustom?.providerId ?? ""} definition and router policy? Add its API key separately through OAuth Login.`}
				onCancel={() => setPendingCustom(null)}
				onConfirm={() => void applyCustom()}
				open={pendingCustom !== null}
				title="Apply custom provider?"
			/>
		</>
	);
}
