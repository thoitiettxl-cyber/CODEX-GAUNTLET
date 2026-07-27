import { useEffect, useMemo, useState, type FormEvent } from "react";
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
	type AuthSession,
	type AuthType,
	type ManagementClient,
	type ProviderInfo,
} from "../../lib/api";
import { useQuery } from "../../lib/api/use-query";
import { formatDate } from "../../lib/format";

const ACTIVE_STATES = new Set(["running", "waiting_for_input"]);

function sessionTone(state: AuthSession["state"]) {
	if (state === "completed") {
		return "positive" as const;
	}
	if (["failed", "expired"].includes(state)) {
		return "negative" as const;
	}
	if (state === "cancelled") {
		return "neutral" as const;
	}
	return "info" as const;
}

function availableModes(provider: ProviderInfo | undefined) {
	return provider?.auth_modes.filter((mode) => mode.login_supported) ?? [];
}

export function OAuthPage({
	activeAccountId,
	client,
	onMutation,
	notify,
}: {
	activeAccountId: string;
	client: ManagementClient;
	onMutation: () => Promise<void>;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const providersQuery = useQuery("auth-providers", () => client.providers());
	const credentialsQuery = useQuery("auth-accounts", () => client.credentials());
	const [providerId, setProviderId] = useState("");
	const [authType, setAuthType] = useState<AuthType>("oauth");
	const [accountId, setAccountId] = useState("");
	const [accountLabel, setAccountLabel] = useState("");
	const [session, setSession] = useState<AuthSession | null>(null);
	const [promptValue, setPromptValue] = useState("");
	const [showSecret, setShowSecret] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const providers = providersQuery.data ?? [];
	const refreshAccounts = credentialsQuery.refresh;
	const provider = providers.find((entry) => entry.id === providerId);
	const modes = useMemo(() => availableModes(provider), [provider]);
	const accounts = useMemo(() => {
		const values = new Map<string, { label: string; active: boolean }>([
			[activeAccountId, { label: activeAccountId, active: true }],
		]);
		for (const credential of credentialsQuery.data ?? []) {
			values.set(credential.account_id, {
				label: credential.account_label,
				active: credential.active || values.get(credential.account_id)?.active === true,
			});
		}
		return [...values].map(([id, value]) => ({ id, ...value }));
	}, [activeAccountId, credentialsQuery.data]);

	useEffect(() => {
		if (providerId || providers.length === 0) {
			return;
		}
		const first = providers.find((entry) => availableModes(entry).length > 0);
		if (first) {
			setProviderId(first.id);
			setAuthType(
				availableModes(first).some((mode) => mode.type === "oauth")
					? "oauth"
					: "api_key",
			);
		}
	}, [providerId, providers]);

	useEffect(() => {
		if (!session || !ACTIVE_STATES.has(session.state)) {
			return;
		}
		let active = true;
		const timer = window.setTimeout(() => {
			void client.getAuthSession(session.id).then((next) => {
				if (!active) {
					return;
				}
				setSession(next);
				if (next.state === "completed" && session.state !== "completed") {
					notify(t("oauth.completed", {
						label: next.credential_label ?? next.provider_name,
					}));
					void Promise.all([onMutation(), refreshAccounts()]);
				}
			}).catch((caught) => {
				if (active) {
					setError(errorMessage(caught));
				}
			});
		}, 900);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [client, notify, onMutation, refreshAccounts, session]);

	const chooseProvider = (nextId: string) => {
		setProviderId(nextId);
		const next = providers.find((entry) => entry.id === nextId);
		const nextModes = availableModes(next);
		if (!nextModes.some((mode) => mode.type === authType)) {
			setAuthType(nextModes[0]?.type ?? "oauth");
		}
	};

	const start = async (event: FormEvent) => {
		event.preventDefault();
		if (!providerId) {
			return;
		}
		setBusy(true);
		setError("");
		setPromptValue("");
		try {
			const created = await client.createAuthSession(providerId, authType, {
				accountId: accountId || undefined,
				label: accountLabel.trim() || undefined,
			});
			setSession(created);
			if (created.state === "completed") {
				notify(t("oauth.completed", {
					label: created.credential_label ?? created.provider_name,
				}));
				await Promise.all([onMutation(), refreshAccounts()]);
			}
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const respond = async (event: FormEvent) => {
		event.preventDefault();
		if (!session?.prompt) {
			return;
		}
		const value = promptValue;
		setPromptValue("");
		setBusy(true);
		setError("");
		try {
			const next = await client.respondAuthSession(session.id, session.prompt.id, value);
			setSession(next);
			if (next.state === "completed") {
				notify(t("oauth.completed", {
					label: next.credential_label ?? next.provider_name,
				}));
				await Promise.all([onMutation(), refreshAccounts()]);
			}
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const cancel = async () => {
		if (!session) {
			return;
		}
		setBusy(true);
		try {
			setSession(await client.cancelAuthSession(session.id));
			setPromptValue("");
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const copy = async (value: string, label: string) => {
		try {
			await navigator.clipboard.writeText(value);
			notify(t("oauth.copied", { label }));
		} catch {
			notify(t("oauth.copyFailed", { label: label.toLowerCase() }), "negative");
		}
	};

	return (
		<>
			<PageHeader
				description={t("oauth.description")}
				eyebrow={t("oauth.eyebrow")}
				title={t("oauth.title")}
			/>
			<InlineNotice>
				<strong>{t("oauth.singleUseTitle")}</strong>{" "}
				{t("oauth.singleUseBody")}
			</InlineNotice>

			<div className="auth-layout">
				<Card>
					<SectionHeader
						description={t("oauth.startBody")}
						title={t("oauth.startTitle")}
					/>
					{providersQuery.phase === "loading" ? <LoadingState label={t("oauth.loadingMethods")} /> : null}
					{providersQuery.phase === "error" ? (
						<ErrorState message={providersQuery.error} onRetry={providersQuery.refresh} />
					) : null}
					{providersQuery.phase === "ready" && providers.length === 0 ? (
						<EmptyState
							description={t("oauth.noProvidersBody")}
							icon="providers"
							title={t("oauth.noProviders")}
						/>
					) : null}
					{providersQuery.phase === "ready" && providers.length > 0 ? (
						<form className="auth-form" onSubmit={(event) => void start(event)}>
							<label className="field">
								<span>{t("oauth.provider")}</span>
								<select
									disabled={Boolean(session && ACTIVE_STATES.has(session.state))}
									name="provider_id"
									onChange={(event) => chooseProvider(event.target.value)}
									value={providerId}
								>
									{providers.map((entry) => (
										<option
											disabled={availableModes(entry).length === 0}
											key={entry.id}
											value={entry.id}
										>
											{entry.name}{availableModes(entry).length === 0
												? ` — ${t("oauth.noInteractive")}`
												: ""}
										</option>
									))}
								</select>
							</label>
							<label className="field">
								<span>{t("oauth.targetAccount")}</span>
								<select
									disabled={Boolean(session && ACTIVE_STATES.has(session.state))}
									name="account_id"
									onChange={(event) => setAccountId(event.target.value)}
									value={accountId}
								>
									<option value="">{t("oauth.newAccount")}</option>
									{accounts.map((account) => (
										<option key={account.id} value={account.id}>
											{account.label} · {account.id}
											{account.active ? ` · ${t("oauth.inferenceAccount")}` : ""}
										</option>
									))}
								</select>
								<small>
									{t("oauth.accountHelp")}
								</small>
							</label>
							<label className="field">
								<span>{t("oauth.accountLabel")} <small>({t("oauth.optional")})</small></span>
								<input
									autoComplete="off"
									disabled={Boolean(session && ACTIVE_STATES.has(session.state))}
									maxLength={96}
									name="account_label"
									onChange={(event) => setAccountLabel(event.target.value)}
									placeholder={t("oauth.accountPlaceholder")}
									value={accountLabel}
								/>
								<small>
									{t("oauth.labelHelp")}
								</small>
							</label>
							<fieldset className="method-picker">
								<legend>{t("oauth.method")}</legend>
								{modes.map((mode) => (
									<label key={mode.type} className={authType === mode.type ? "selected" : ""}>
										<input
											checked={authType === mode.type}
											disabled={Boolean(session && ACTIVE_STATES.has(session.state))}
											name="auth_type"
											onChange={() => setAuthType(mode.type)}
											type="radio"
											value={mode.type}
										/>
										<span className="method-icon"><Icon name={mode.type === "oauth" ? "login" : "key"} /></span>
										<span>
											<strong>{mode.type === "oauth" ? t("oauth.oauthMethod") : t("oauth.apiKeyMethod")}</strong>
											<small>
												{mode.type === "oauth"
													? t("oauth.oauthHelp")
													: t("oauth.apiKeyHelp")}
											</small>
										</span>
									</label>
								))}
							</fieldset>
							<Button
								className="auth-start"
								disabled={busy || modes.length === 0 || Boolean(session && ACTIVE_STATES.has(session.state))}
								type="submit"
								variant="primary"
							>
								{busy
									? t("oauth.starting")
									: t("oauth.startSession", {
										type: authType === "oauth"
											? t("oauth.oauthShort")
											: t("oauth.apiKeyShort"),
									})}
							</Button>
						</form>
					) : null}
				</Card>

				<Card className="session-card">
					<SectionHeader
						actions={session && ACTIVE_STATES.has(session.state) ? (
							<Button disabled={busy} onClick={() => void cancel()} variant="danger">{t("oauth.cancelSession")}</Button>
						) : null}
						description={t("oauth.sessionActivityBody")}
						title={t("oauth.sessionActivity")}
					/>
					{error ? <InlineNotice tone="negative">{error}</InlineNotice> : null}
					{!session ? (
						<EmptyState
							description={t("oauth.noSessionBody")}
							icon="login"
							title={t("oauth.noSession")}
						/>
					) : (
						<div className="session-view">
							<div className="session-summary">
								<div>
									<span>{t("oauth.provider")}</span>
									<strong>{session.provider_name}</strong>
									<code>{session.provider_id}</code>
								</div>
								<div>
									<span>{t("oauth.account")}</span>
									<strong>{session.credential_label ?? session.account_label}</strong>
									<code>{session.account_id}</code>
								</div>
								<div>
									<span>{t("oauth.status")}</span>
									<Badge tone={sessionTone(session.state)}>{t(`oauth.states.${session.state}`)}</Badge>
								</div>
								<div>
									<span>{t("oauth.expires")}</span>
									<strong>{formatDate(session.expires_at)}</strong>
								</div>
							</div>

							{session.prompt ? (
								<form className="prompt-panel" onSubmit={(event) => void respond(event)}>
									<div className="prompt-heading">
										<div className="prompt-icon"><Icon name={session.prompt.type === "secret" ? "key" : "login"} /></div>
										<div>
											<span>{t("oauth.providerPrompt")}</span>
											<h3>{session.prompt.message}</h3>
										</div>
									</div>
									{session.prompt.type === "select" ? (
										<label className="field">
											<span>{t("oauth.chooseOption")}</span>
											<select
												autoFocus
												name="prompt_response"
												onChange={(event) => setPromptValue(event.target.value)}
												value={promptValue}
											>
												<option value="">{t("oauth.selectOne")}</option>
												{session.prompt.options?.map((option) => (
													<option key={option.id} value={option.id}>{option.label}</option>
												))}
											</select>
										</label>
									) : (
										<label className="field">
											<span>{session.prompt.type === "secret" ? t("oauth.secretResponse") : t("oauth.response")}</span>
											<div className={session.prompt.type === "secret" ? "secret-input" : ""}>
												{session.prompt.type === "secret" ? <Icon name="key" /> : null}
												<input
													autoComplete="off"
													autoFocus
													name="prompt_response"
													onChange={(event) => setPromptValue(event.target.value)}
													placeholder={session.prompt.placeholder ?? t("oauth.responsePlaceholder")}
													spellCheck={false}
													type={session.prompt.type === "secret" && !showSecret ? "password" : "text"}
													value={promptValue}
												/>
												{session.prompt.type === "secret" ? (
													<button onClick={() => setShowSecret((value) => !value)} type="button">
														{showSecret ? t("common.hide") : t("common.show")}
													</button>
												) : null}
											</div>
										</label>
									)}
									<Button
										disabled={
											busy
												|| (
													session.prompt.type === "select"
													&& promptValue.length === 0
												)
										}
										type="submit"
										variant="primary"
									>
										{busy ? t("oauth.submitting") : t("oauth.submitOnce")}
									</Button>
								</form>
							) : null}

							{session.events.length > 0 ? (
								<ol className="auth-timeline">
									{session.events.map((event) => (
										<li key={event.id}>
											<span className="timeline-dot" />
											<div>
												<div className="timeline-meta">
													<Badge tone="neutral">{t(`oauth.events.${event.type}`)}</Badge>
													<time>{formatDate(event.created_at)}</time>
												</div>
												{event.message ? <p>{event.message}</p> : null}
												{event.instructions ? <p>{event.instructions}</p> : null}
												{event.url ? (
													<a href={event.url} rel="noreferrer" target="_blank">
														{t("oauth.openSignIn")} <Icon name="external" />
													</a>
												) : null}
												{event.user_code && event.verification_uri ? (
													<div className="device-code">
														<div>
															<span>{t("oauth.deviceCode")}</span>
															<code>{event.user_code}</code>
														</div>
														<Button
															icon="copy"
															onClick={() => void copy(event.user_code!, t("oauth.deviceCode"))}
															size="compact"
														>
															{t("common.copy")}
														</Button>
														<a href={event.verification_uri} rel="noreferrer" target="_blank">
															{t("oauth.openVerification")} <Icon name="external" />
														</a>
													</div>
												) : null}
												{event.links?.map((link) => (
													<a href={link.url} key={link.url} rel="noreferrer" target="_blank">
														{link.label ?? t("oauth.providerInformation")} <Icon name="external" />
													</a>
												))}
											</div>
										</li>
									))}
								</ol>
							) : (
								<p className="waiting-copy">
									<span className={ACTIVE_STATES.has(session.state) ? "spinner" : ""} />
									{ACTIVE_STATES.has(session.state)
										? t("oauth.waiting")
										: t("oauth.noProgress")}
								</p>
							)}

							{!ACTIVE_STATES.has(session.state) ? (
								<div className={`session-terminal terminal-${session.state}`}>
									<Icon name={session.state === "completed" ? "check" : "warning"} />
									<div>
										<strong>
											{session.state === "completed"
												? t("oauth.saved")
												: t("oauth.sessionState", {
													state: t(`oauth.states.${session.state}`),
												})}
										</strong>
										<p>
											{session.state === "completed"
												? t("oauth.savedBody", {
													label: session.credential_label ?? session.account_label,
												})
												: t("oauth.failedBody", {
													code: session.error_code ?? "",
												})}
										</p>
									</div>
									<Button onClick={() => {
										setSession(null);
										setError("");
										setPromptValue("");
									}}>
										{t("oauth.startAnother")}
									</Button>
								</div>
							) : null}
						</div>
					)}
				</Card>
			</div>
		</>
	);
}
