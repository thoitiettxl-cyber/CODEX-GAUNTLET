import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

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
	const { t } = useTranslation();
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
			const config = await client.getConfig();
			if (!config.editable || !config.document) {
				throw new Error(t("providers.configUnavailable"));
			}
			const document = structuredClone(config.document);
			const providerMap = (
				typeof document.providers === "object"
				&& document.providers !== null
				&& !Array.isArray(document.providers)
			) ? document.providers as Record<string, unknown> : {};
			if (providerMap[custom.id]) {
				throw new Error(t("providers.duplicate"));
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
						|| t("providers.validationFailed"),
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
						</select>
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
								customBusy
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
