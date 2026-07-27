import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { parseDocument } from "yaml";

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
	type ManagementStatus,
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
	api: "openai-responses" | "openai-completions" | "anthropic-messages";
	apiKey: string;
	modelId: string;
	modelAlias: string;
	prefix: string;
	proxyUrl: string;
	headers: string;
	excludedModels: string;
}

const EMPTY_CUSTOM: CustomProviderDraft = {
	id: "",
	name: "",
	baseUrl: "",
	api: "openai-responses",
	apiKey: "",
	modelId: "",
	modelAlias: "",
	prefix: "",
	proxyUrl: "",
	headers: "{}",
	excludedModels: "",
};

export function ProvidersPage({
	client,
	status,
	onMutation,
	notify,
}: {
	client: ManagementClient;
	status: ManagementStatus;
	onMutation: () => Promise<void>;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const [filter, setFilter] = useState("");
	const [custom, setCustom] = useState<CustomProviderDraft>(EMPTY_CUSTOM);
	const [customError, setCustomError] = useState("");
	const [customBusy, setCustomBusy] = useState(false);
	const [testBusy, setTestBusy] = useState(false);
	const [pendingCustom, setPendingCustom] = useState<{
		source: string;
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
				throw new Error(t("providers.invalidId"));
			}
			const headers = JSON.parse(custom.headers) as unknown;
			if (
				typeof headers !== "object"
				|| headers === null
				|| Array.isArray(headers)
				|| Object.values(headers).some((value) => typeof value !== "string")
			) {
				throw new Error(t("providers.invalidHeaders"));
			}
			if (!status.capabilities.custom_provider_protocols.includes(custom.api)) {
				throw new Error(t("providers.configUnavailable"));
			}
			const config = await client.rawConfig();
			const document = parseDocument(config.source);
			const issue = document.errors[0];
			if (issue) {
				throw new Error(issue.message);
			}
			if (document.getIn(["providers", custom.id]) !== undefined) {
				throw new Error(t("providers.duplicate"));
			}
			const excludedModels = custom.excludedModels
				.split(/\r?\n|,/u)
				.map((value) => value.trim())
				.filter(Boolean);
			document.setIn(["providers", custom.id], {
				name: custom.name.trim() || custom.id,
				baseUrl: custom.baseUrl.trim(),
				api: custom.api,
				...(custom.apiKey ? { apiKey: custom.apiKey } : {}),
				authHeader: true,
				...(Object.keys(headers).length > 0 ? { headers } : {}),
				models: [{
					id: custom.modelId.trim(),
					name: custom.modelId.trim(),
				}],
				...(custom.proxyUrl.trim() ? { proxyUrl: custom.proxyUrl.trim() } : {}),
				...(custom.prefix.trim() ? { prefix: custom.prefix.trim() } : {}),
				...(custom.modelAlias.trim()
					? { modelAliases: { [custom.modelId.trim()]: custom.modelAlias.trim() } }
					: {}),
				...(excludedModels.length > 0 ? { excludedModels } : {}),
			});
			setPendingCustom({
				source: document.toString(),
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
			await client.putRawConfig(pendingCustom.source);
			notify(t("providers.added", { id: pendingCustom.providerId }));
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

	const testProtocol = async () => {
		setTestBusy(true);
		setCustomError("");
		const controller = new AbortController();
		const timer = window.setTimeout(() => controller.abort(), 20_000);
		try {
			const headers = JSON.parse(custom.headers) as Record<string, string>;
			const base = custom.baseUrl.trim().replace(/\/+$/u, "");
			const route = custom.api === "openai-responses"
				? "/responses"
				: custom.api === "openai-completions"
					? "/chat/completions"
					: "/messages";
			const requestHeaders: Record<string, string> = {
				"content-type": "application/json",
				...headers,
			};
			if (custom.api === "anthropic-messages") {
				if (custom.apiKey) {
					requestHeaders["x-api-key"] = custom.apiKey;
				}
				requestHeaders["anthropic-version"] ??= "2023-06-01";
			} else if (custom.apiKey) {
				requestHeaders.authorization = `Bearer ${custom.apiKey}`;
			}
			const body = custom.api === "openai-responses"
				? { model: custom.modelId, input: "Reply with OK.", max_output_tokens: 8 }
				: custom.api === "openai-completions"
					? {
						model: custom.modelId,
						messages: [{ role: "user", content: "Reply with OK." }],
						max_tokens: 8,
					}
					: {
						model: custom.modelId,
						messages: [{ role: "user", content: "Reply with OK." }],
						max_tokens: 8,
					};
			const response = await fetch(`${base}${route}`, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(t("providers.testFailed", { status: response.status }));
			}
			notify(t("providers.testPassed"));
		} catch (caught) {
			setCustomError(errorMessage(caught));
		} finally {
			window.clearTimeout(timer);
			setTestBusy(false);
		}
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={query.refresh}>{t("providers.refresh")}</Button>}
				description={t("providers.description")}
				eyebrow={t("providers.eyebrow")}
				title={t("providers.title")}
			/>
			<div className="summary-strip">
				<div><span>{t("providers.registered")}</span><strong>{formatNumber(providers.length)}</strong></div>
				<div><span>{t("providers.configured")}</span><strong>{formatNumber(configured)}</strong></div>
				<div><span>{t("providers.availableModels")}</span><strong>{formatNumber(availableModels)}</strong></div>
				<div>
					<span>{t("providers.inventoryState")}</span>
					<Badge tone={providers.some((provider) => provider.state === "error") ? "warning" : "positive"}>
						{providers.some((provider) => provider.state === "error")
							? t("providers.needsReview")
							: t("providers.operational")}
					</Badge>
				</div>
			</div>

			<Card>
				<SectionHeader
					actions={<a className="text-link" href="#/config">{t("providers.advancedEditor")} <Icon name="arrow" /></a>}
					description={t("providers.customDescription")}
					title={t("providers.customTitle")}
				/>
				<InlineNotice>{t("providers.customNotice")}</InlineNotice>
				{!status.capabilities.raw_config ? (
					<InlineNotice tone="warning">{t("providers.configUnavailable")}</InlineNotice>
				) : null}
				{customError ? <InlineNotice tone="negative">{customError}</InlineNotice> : null}
				<form className="custom-provider-form" onSubmit={(event) => void previewCustom(event)}>
					<label className="field">
						<span>{t("providers.providerId")}</span>
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
						<span>{t("providers.displayName")}</span>
						<input
							maxLength={160}
							name="custom_provider_name"
							onChange={(event) => updateCustom("name", event.target.value)}
							placeholder={t("providers.displayNamePlaceholder")}
							value={custom.name}
						/>
					</label>
					<label className="field field-wide">
						<span>{t("providers.baseUrl")}</span>
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
						<span>{t("providers.protocol")}</span>
						<select
							name="custom_provider_api"
							onChange={(event) => updateCustom(
								"api",
								event.target.value as CustomProviderDraft["api"],
							)}
							value={custom.api}
						>
							<option value="openai-responses">{t("providers.protocolResponses")}</option>
							<option value="openai-completions">{t("providers.protocolCompletions")}</option>
							<option value="anthropic-messages">{t("providers.protocolAnthropic")}</option>
						</select>
					</label>
					<label className="field">
						<span>{t("providers.apiKey")} <small>({t("providers.optional")})</small></span>
						<input
							autoComplete="off"
							name="custom_provider_api_key"
							onChange={(event) => updateCustom("apiKey", event.target.value)}
							spellCheck={false}
							type="password"
							value={custom.apiKey}
						/>
					</label>
					<label className="field">
						<span>{t("providers.modelId")}</span>
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
						<span>{t("providers.modelAlias")} <small>({t("providers.optional")})</small></span>
						<input
							maxLength={160}
							name="custom_provider_alias"
							onChange={(event) => updateCustom("modelAlias", event.target.value)}
							placeholder="fast"
							value={custom.modelAlias}
						/>
					</label>
					<label className="field">
						<span>{t("providers.prefix")} <small>({t("providers.optional")})</small></span>
						<input
							maxLength={160}
							name="custom_provider_prefix"
							onChange={(event) => updateCustom("prefix", event.target.value)}
							placeholder="team-a"
							value={custom.prefix}
						/>
					</label>
					<label className="field">
						<span>{t("providers.proxyUrl")} <small>({t("providers.optional")})</small></span>
						<input
							name="custom_provider_proxy"
							onChange={(event) => updateCustom("proxyUrl", event.target.value)}
							placeholder="http://127.0.0.1:8080"
							type="url"
							value={custom.proxyUrl}
						/>
					</label>
					<label className="field">
						<span>{t("providers.headers")}</span>
						<textarea
							name="custom_provider_headers"
							onChange={(event) => updateCustom("headers", event.target.value)}
							spellCheck={false}
							value={custom.headers}
						/>
					</label>
					<label className="field">
						<span>{t("providers.excludedModels")}</span>
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
								testBusy
								|| !custom.baseUrl.trim()
								|| !custom.modelId.trim()
							}
							onClick={() => void testProtocol()}
							type="button"
						>
							{testBusy ? t("providers.testing") : t("providers.testProtocol")}
						</Button>
						<Button
							disabled={
								customBusy
								|| !status.capabilities.raw_config
								|| !custom.id.trim()
								|| !custom.baseUrl.trim()
								|| !custom.modelId.trim()
							}
							icon="shield"
							type="submit"
							variant="primary"
						>
							{customBusy ? t("providers.validating") : t("providers.validate")}
						</Button>
					</div>
				</form>
			</Card>

			<Card>
				<SectionHeader
					actions={
						<SearchField
							label={t("providers.filter")}
							onChange={setFilter}
							placeholder={t("providers.filterPlaceholder")}
							value={filter}
						/>
					}
					description={t("providers.inventoryBody")}
					title={t("providers.inventory")}
				/>
				{query.phase === "loading" ? <LoadingState label={t("providers.loading")} /> : null}
				{query.phase === "error" ? (
					<ErrorState message={query.error} onRetry={query.refresh} />
				) : null}
				{query.phase === "ready" && providers.length === 0 ? (
					<EmptyState
						action={<a className="text-link" href="#/config">{t("providers.openConfig")} <Icon name="arrow" /></a>}
						description={t("providers.noneBody")}
						icon="providers"
						title={t("providers.none")}
					/>
				) : null}
				{query.phase === "ready" && providers.length > 0 && visible.length === 0 ? (
					<EmptyState
						description={t("providers.noMatchBody")}
						icon="search"
						title={t("providers.noMatch")}
					/>
				) : null}
				{query.phase === "ready" && visible.length > 0 ? (
					<div className="table-wrap">
						<table>
							<caption className="visually-hidden">{t("providers.inventory")}</caption>
							<thead>
								<tr>
									<th scope="col">{t("providers.provider")}</th>
									<th scope="col">{t("providers.state")}</th>
									<th scope="col">{t("providers.authentication")}</th>
									<th scope="col">{t("providers.models")}</th>
									<th scope="col"><span className="visually-hidden">{t("common.actions")}</span></th>
								</tr>
							</thead>
							<tbody>
								{visible.map((provider) => (
									<tr key={provider.id}>
										<td data-label={t("providers.provider")}>
											<div className="provider-cell">
												<span className="provider-avatar">{provider.name.slice(0, 2).toUpperCase()}</span>
												<div>
													<strong>{provider.name}</strong>
													<code>{provider.id}</code>
												</div>
											</div>
										</td>
										<td data-label={t("providers.state")}>
											<Badge tone={providerTone(provider.state)}>
												{t(`providers.states.${provider.state}`)}
											</Badge>
											{provider.configured_source ? (
												<small className="cell-detail">{provider.configured_source}</small>
											) : null}
										</td>
										<td data-label={t("providers.authentication")}>
											<div className="badge-row">
												{provider.auth_modes.map((mode) => (
													<Badge key={mode.type} tone={mode.login_supported ? "info" : "neutral"}>
														{mode.type === "api_key" ? t("providers.apiKey") : t("providers.oauth")}
													</Badge>
												))}
											</div>
											<small className="cell-detail">
												{provider.credential_count > 0
													? t("providers.credentialsStored", { count: provider.credential_count })
													: t("providers.noCredentials")}
											</small>
											{provider.configuration_required ? (
												<small className="cell-detail">
													{t("providers.requires", {
														value: provider.configuration_required,
													})}
												</small>
											) : null}
										</td>
										<td data-label={t("providers.models")}>
											<span>{t("providers.modelCounts", {
												available: provider.available_model_count,
												known: provider.model_count,
											})}</span>
										</td>
										<td className="table-action">
											<a
												aria-label={t("providers.authenticate", { name: provider.name })}
												className="row-action"
												href="#/oauth"
											>
												<span>{provider.configured ? t("providers.replaceLogin") : t("providers.setUp")}</span>
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
				confirmLabel={t("providers.addCustom")}
				description={t("providers.applyBody", { id: pendingCustom?.providerId ?? "" })}
				onCancel={() => setPendingCustom(null)}
				onConfirm={() => void applyCustom()}
				open={pendingCustom !== null}
				title={t("providers.applyTitle")}
			/>
		</>
	);
}
