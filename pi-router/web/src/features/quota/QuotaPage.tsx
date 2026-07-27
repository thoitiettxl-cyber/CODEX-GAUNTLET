import { useState } from "react";

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
						{phase === "loading" ? "Reading account quota…" : "Refresh account quota"}
					</Button>
				}
				description="Real provider-backed limits are read separately for every OAuth credential and provider."
				eyebrow="Observe"
				title="Quota Management"
			/>
			<InlineNotice>
				Quota reads are explicit, credential-scoped, and adapter-specific. Credentials without a reviewed adapter
				return <strong>Unsupported</strong> without an exploratory network request.
			</InlineNotice>

			{phase === "idle" ? (
				<Card>
					<EmptyState
						action={<Button icon="quota" onClick={() => void load()} variant="primary">Read quota now</Button>}
						description="No credential quota request runs when this page opens. Start a bounded read when you need current capacity."
						icon="quota"
						title="Quota has not been requested"
					/>
				</Card>
			) : null}
			{phase === "loading" ? (
				<Card><LoadingState label="Reading reviewed quota adapters…" /></Card>
			) : null}
			{phase === "error" ? (
				<Card><ErrorState message={error} onRetry={() => void load()} /></Card>
			) : null}
			{phase === "ready" ? (
				<>
					<div className="summary-strip">
						<div><span>Credentials</span><strong>{formatNumber(results.length)}</strong></div>
						<div><span>Quota available</span><strong>{formatNumber(supported)}</strong></div>
						<div><span>Unsupported</span><strong>{formatNumber(unsupported)}</strong></div>
						<div>
							<span>Source</span>
							<Badge tone="info">Provider adapters</Badge>
						</div>
					</div>
					<Card>
						<SectionHeader
							description="Each isolated account reports an independent typed capability and provider-specific windows."
							title="Credential capacity"
						/>
						{results.length === 0 ? (
							<EmptyState
								description="No stored credential metadata is available."
								icon="providers"
								title="No providers to inspect"
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
												{result.status}
											</Badge>
											{result.active ? <Badge tone="positive">Inference account</Badge> : null}
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
																		{formatNumber(window.remaining)} <small>{window.unit} remaining</small>
																	</strong>
																</div>
																<progress
																	aria-label={`${Math.round(percentage)} percent used`}
																	className="progress-track"
																	max={100}
																	value={percentage}
																/>
																<p>
																	{formatNumber(window.used)} of {formatNumber(window.limit)} used
																	{window.resets_at ? ` · resets ${formatDate(window.resets_at)}` : ""}
																</p>
															</div>
														);
													})}
												</div>
												<footer>
													<Icon name="clock" />
													Checked {formatDate(result.checked_at)}
												</footer>
											</>
										) : (
											<div className="quota-empty">
												<Icon name={result.status === "error" ? "warning" : "shield"} />
												<div>
													<strong>
														{result.status === "unsupported"
															? "No reviewed adapter"
															: "Adapter unavailable"}
													</strong>
													<p>
														{result.status === "unsupported"
															? "Pi Router made no quota request for this credential."
															: "The bounded provider quota read failed without returning a raw response."}
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
