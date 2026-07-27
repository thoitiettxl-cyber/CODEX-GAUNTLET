import { useState } from "react";
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
	SectionHeader,
} from "../../components/ui";
import { Icon } from "../../components/ui/Icon";
import {
	errorMessage,
	type ManagementClient,
	type QuotaResult,
} from "../../lib/api";
import { formatDate, formatNumber } from "../../lib/format";

export function QuotaPage({ client }: { client: ManagementClient }) {
	const { t } = useTranslation();
	const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
	const [results, setResults] = useState<QuotaResult[]>([]);
	const [error, setError] = useState("");

	const load = async () => {
		setPhase("loading");
		setError("");
		try {
			setResults(await client.quota());
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			setPhase("error");
		}
	};

	const supported = results.filter((result) => result.status === "available").length;
	const unsupported = results.filter((result) => result.status === "unsupported").length;

	return (
		<>
			<PageHeader
				actions={
					<Button
						disabled={phase === "loading"}
						icon="refresh"
						onClick={() => void load()}
						variant="primary"
					>
						{phase === "loading" ? t("quota.reading") : t("quota.refresh")}
					</Button>
				}
				description={t("quota.description")}
				eyebrow={t("quota.eyebrow")}
				title={t("quota.title")}
			/>
			<InlineNotice>
				{t("quota.notice")}
			</InlineNotice>

			{phase === "idle" ? (
				<Card>
					<EmptyState
						action={<Button icon="quota" onClick={() => void load()} variant="primary">{t("quota.readNow")}</Button>}
						description={t("quota.notRequestedBody")}
						icon="quota"
						title={t("quota.notRequested")}
					/>
				</Card>
			) : null}
			{phase === "loading" ? (
				<Card><LoadingState label={t("quota.loading")} /></Card>
			) : null}
			{phase === "error" ? (
				<Card><ErrorState message={error} onRetry={() => void load()} /></Card>
			) : null}
			{phase === "ready" ? (
				<>
					<div className="summary-strip">
						<div><span>{t("quota.credentials")}</span><strong>{formatNumber(results.length)}</strong></div>
						<div><span>{t("quota.available")}</span><strong>{formatNumber(supported)}</strong></div>
						<div><span>{t("quota.unsupported")}</span><strong>{formatNumber(unsupported)}</strong></div>
						<div>
							<span>{t("quota.source")}</span>
							<Badge tone="info">{t("quota.providerAdapters")}</Badge>
						</div>
					</div>
					<Card>
						<SectionHeader
							description={t("quota.capacityBody")}
							title={t("quota.capacity")}
						/>
						{results.length === 0 ? (
							<EmptyState
								description={t("quota.noneBody")}
								icon="providers"
								title={t("quota.none")}
							/>
						) : (
							<div className="quota-grid">
								{results.map((result) => (
									<article className={`quota-card quota-${result.status}`} key={result.credential_id}>
										<header>
											<div className="provider-cell">
												<span className="provider-avatar">{result.provider_name.slice(0, 2).toUpperCase()}</span>
												<div>
													<strong>{result.credential_label}</strong>
													<code>{result.provider_name} · {result.account_label}</code>
												</div>
											</div>
											<Badge
												tone={
													result.status === "available"
														? "positive"
														: result.status === "error" ? "negative" : "neutral"
												}
											>
												{t(`quota.states.${result.status}`)}
											</Badge>
											{result.active ? <Badge tone="positive">{t("quota.inferenceAccount")}</Badge> : null}
										</header>
										{result.status === "available" ? (
											<>
												<div className="quota-windows">
													{result.windows.map((window) => {
														const percentage = window.limit === 0
															? 0
															: Math.min(100, (window.used / window.limit) * 100);
														return (
															<div className="quota-window" key={`${window.label}-${window.unit}`}>
																<div>
																	<span>{window.label}</span>
																	<strong>
																		{t("quota.remaining", {
																			count: formatNumber(window.remaining),
																			unit: window.unit,
																		})}
																	</strong>
																</div>
																<progress
																	aria-label={t("quota.percentUsed", { percent: Math.round(percentage) })}
																	className="progress-track"
																	max={100}
																	value={percentage}
																/>
																<p>
																	{t("quota.used", {
																		used: formatNumber(window.used),
																		limit: formatNumber(window.limit),
																	})}
																	{window.resets_at
																		? ` · ${t("quota.resets", { date: formatDate(window.resets_at) })}`
																		: ""}
																</p>
															</div>
														);
													})}
												</div>
												<footer>
													<Icon name="clock" />
													{t("quota.checked", { date: formatDate(result.checked_at) })}
												</footer>
											</>
										) : (
											<div className="quota-empty">
												<Icon name={result.status === "error" ? "warning" : "shield"} />
												<div>
													<strong>
														{result.status === "unsupported"
															? t("quota.noAdapter")
															: t("quota.adapterUnavailable")}
													</strong>
													<p>
														{result.status === "unsupported"
															? t("quota.unsupportedBody")
															: t("quota.errorBody")}
													</p>
												</div>
											</div>
										)}
									</article>
								))}
							</div>
						)}
					</Card>
				</>
			) : null}
		</>
	);
}
