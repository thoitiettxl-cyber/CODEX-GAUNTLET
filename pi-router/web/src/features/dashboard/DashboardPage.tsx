import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	InlineNotice,
	PageHeader,
	SectionHeader,
	StatCard,
} from "../../components/ui";
import { Icon } from "../../components/ui/Icon";
import {
	errorMessage,
	type ManagementClient,
	type ManagementStatus,
	type ProxyKeyInfo,
	type UpdateCandidate,
} from "../../lib/api";
import {
	formatBytes,
	formatDate,
	formatNumber,
	formatUptime,
} from "../../lib/format";

type PendingAction = "install" | "rollback" | null;
type PendingKeyAction = { action: "replace" | "remove"; key: ProxyKeyInfo } | null;

export function DashboardPage({
	client,
	status,
	onRefreshStatus,
	notify,
}: {
	client: ManagementClient;
	status: ManagementStatus;
	onRefreshStatus: () => Promise<void>;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const [candidate, setCandidate] = useState<UpdateCandidate | null>(null);
	const [updatePhase, setUpdatePhase] = useState<"idle" | "checking" | "mutating">("idle");
	const [updateError, setUpdateError] = useState("");
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [proxyKeys, setProxyKeys] = useState<ProxyKeyInfo[]>([]);
	const [proxyKeyPhase, setProxyKeyPhase] = useState<"loading" | "ready" | "error">("loading");
	const [proxyKeyError, setProxyKeyError] = useState("");
	const [newKeyLabel, setNewKeyLabel] = useState("");
	const [keyLabels, setKeyLabels] = useState<Record<string, string>>({});
	const [revealedKey, setRevealedKey] = useState("");
	const [revealedKeyVisible, setRevealedKeyVisible] = useState(false);
	const [pendingKeyAction, setPendingKeyAction] = useState<PendingKeyAction>(null);
	const [keyBusy, setKeyBusy] = useState(false);
	const activitySuccess = status.activity.requests === 0
		? null
		: Math.max(
			0,
			Math.round(
				((status.activity.requests - status.activity.errors)
					/ status.activity.requests) * 100,
			),
		);
	const activityStep = Math.round((activitySuccess ?? 100) / 10);

	const loadProxyKeys = async () => {
		setProxyKeyPhase("loading");
		try {
			const keys = await client.proxyKeys();
			setProxyKeys(keys);
			setKeyLabels(Object.fromEntries(keys.map((key) => [key.id, key.label])));
			setProxyKeyError("");
			setProxyKeyPhase("ready");
		} catch (error) {
			setProxyKeyError(errorMessage(error));
			setProxyKeyPhase("error");
		}
	};

	useEffect(() => {
		void loadProxyKeys();
	}, [client]);

	const createProxyKey = async (event: FormEvent) => {
		event.preventDefault();
		if (!newKeyLabel.trim()) {
			return;
		}
		setKeyBusy(true);
		setProxyKeyError("");
		try {
			const created = await client.createProxyKey(newKeyLabel);
			setRevealedKey(created.value ?? "");
			setRevealedKeyVisible(false);
			setNewKeyLabel("");
			await Promise.all([loadProxyKeys(), onRefreshStatus()]);
			notify(t("dashboard.keyCreated"));
		} catch (error) {
			setProxyKeyError(errorMessage(error));
		} finally {
			setKeyBusy(false);
		}
	};

	const saveKeyLabel = async (key: ProxyKeyInfo) => {
		const next = keyLabels[key.id]?.trim();
		if (!next || next === key.label) {
			return;
		}
		setKeyBusy(true);
		try {
			await client.updateProxyKey(key.id, next);
			await loadProxyKeys();
			notify(t("dashboard.keyLabelUpdated"));
		} catch (error) {
			setProxyKeyError(errorMessage(error));
		} finally {
			setKeyBusy(false);
		}
	};

	const mutateProxyKey = async () => {
		if (!pendingKeyAction) {
			return;
		}
		setKeyBusy(true);
		setProxyKeyError("");
		try {
			if (pendingKeyAction.action === "replace") {
				const replaced = await client.replaceProxyKey(pendingKeyAction.key.id);
				setRevealedKey(replaced.value ?? "");
				setRevealedKeyVisible(false);
				notify(t("dashboard.keyReplaced"));
			} else {
				await client.removeProxyKey(pendingKeyAction.key.id);
				notify(t("dashboard.keyRemoved"));
			}
			setPendingKeyAction(null);
			await Promise.all([loadProxyKeys(), onRefreshStatus()]);
		} catch (error) {
			setProxyKeyError(errorMessage(error));
			setPendingKeyAction(null);
		} finally {
			setKeyBusy(false);
		}
	};

	const copyRevealedKey = async () => {
		try {
			await navigator.clipboard.writeText(revealedKey);
			notify(t("dashboard.keyCopied"));
		} catch {
			notify(t("dashboard.keyCopyFailed"), "negative");
		}
	};

	const checkUpdate = async () => {
		setUpdatePhase("checking");
		setUpdateError("");
		try {
			setCandidate(await client.checkUpdate());
		} catch (error) {
			setUpdateError(errorMessage(error));
		} finally {
			setUpdatePhase("idle");
		}
	};

	const confirmMutation = async () => {
		if (!pendingAction) {
			return;
		}
		setUpdatePhase("mutating");
		setUpdateError("");
		try {
			if (pendingAction === "install" && candidate) {
				await client.installUpdate(candidate.latest_version);
				notify(t("dashboard.versionInstalled", { version: candidate.latest_version }));
			} else if (pendingAction === "rollback") {
				await client.rollbackUpdate();
				notify(t("dashboard.binaryRestored"));
			}
			setPendingAction(null);
			await onRefreshStatus();
		} catch (error) {
			setUpdateError(errorMessage(error));
			setPendingAction(null);
		} finally {
			setUpdatePhase("idle");
		}
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={() => void onRefreshStatus()}>{t("dashboard.refreshStatus")}</Button>}
				description={t("dashboard.description")}
				eyebrow={t("dashboard.eyebrow")}
				title={t("dashboard.title")}
			/>

			{status.update.restart_required ? (
				<InlineNotice tone="warning">
					<strong>{t("dashboard.restartRequired")}</strong>{" "}
					{t("dashboard.restartMessage", {
						version: status.update.pending_version ?? "—",
					})}
				</InlineNotice>
			) : null}
			<InlineNotice tone="positive">
				<strong>
					{status.connection.status === "connected"
						? t("dashboard.connected")
						: t("dashboard.unavailable")}.
				</strong>{" "}
				{t("dashboard.connectionNotice", {
					count: status.authentication.proxy_api_keys,
				})}
			</InlineNotice>

			<div className="stat-grid">
				<StatCard
					detail={t("dashboard.serverDetail", {
						version: status.service.version,
						uptime: formatUptime(status.service.uptime_seconds),
					})}
					icon="server"
					label={t("dashboard.connection")}
					tone="positive"
					value={t("app.connected")}
				/>
				<StatCard
					detail={t("dashboard.providersDetail", {
						configured: status.account.configured_providers,
						total: status.account.providers,
					})}
					icon="providers"
					label={t("dashboard.providers")}
					value={formatNumber(status.account.providers)}
				/>
				<StatCard
					detail={t("dashboard.modelsDetail", {
						count: status.account.stored_credentials,
					})}
					icon="server"
					label={t("dashboard.models")}
					tone="positive"
					value={formatNumber(status.account.available_models)}
				/>
				<StatCard
					detail={t("dashboard.proxyKeysDetail")}
					icon="key"
					label={t("dashboard.proxyKeys")}
					value={formatNumber(status.authentication.proxy_api_keys)}
				/>
				<StatCard
					detail={t("dashboard.activityDetail", { count: status.activity.errors })}
					icon="logs"
					label={t("dashboard.activity")}
					tone={status.activity.errors > 0 ? "warning" : "default"}
					value={formatNumber(status.activity.requests)}
				/>
				<StatCard
					detail={t("dashboard.quotaDetail", {
						supported: status.quota.supported_providers,
						total: status.quota.total_providers,
					})}
					icon="quota"
					label={t("dashboard.quotaCoverage")}
					value={formatNumber(status.quota.supported_providers)}
				/>
			</div>

			<div className="dashboard-grid">
				<Card>
					<SectionHeader
						description={t("dashboard.runtimePostureBody")}
						title={t("dashboard.runtimePosture")}
					/>
					<dl className="detail-list">
						<div>
							<dt>{t("dashboard.service")}</dt>
							<dd>
								<span className="health-dot" />
								{status.service.name} v{status.service.version}
							</dd>
						</div>
						<div>
							<dt>{t("dashboard.uptime")}</dt>
							<dd>{formatUptime(status.service.uptime_seconds)}</dd>
						</div>
						<div>
							<dt>{t("dashboard.selectedAccount")}</dt>
							<dd><code>{status.account.id}</code></dd>
						</div>
						<div>
							<dt>{t("dashboard.runtime")}</dt>
							<dd>{status.runtime.mode} · Node {status.runtime.node}</dd>
						</div>
						<div>
							<dt>{t("dashboard.platform")}</dt>
							<dd>{status.runtime.platform} / {status.runtime.arch}</dd>
						</div>
						<div>
							<dt>{t("dashboard.configuration")}</dt>
							<dd>
								<Badge tone={status.config.state === "ready" ? "positive" : "warning"}>
									{t(`dashboard.configStates.${status.config.state}`)}
								</Badge>
								{status.config.recovery_available
									? t("dashboard.recoveryAvailable")
									: t("dashboard.noRecovery")}
							</dd>
						</div>
					</dl>
				</Card>

				<Card>
					<SectionHeader
						description={t("dashboard.activitySummaryBody")}
						title={t("dashboard.activitySummary")}
					/>
					<div className="activity-visual">
						<div
							aria-label={
								activitySuccess === null
									? t("dashboard.noRequests")
									: t("dashboard.percentSuccessful", { percent: activitySuccess })
							}
							className={`activity-ring activity-ring-${activityStep}`}
							role="img"
						>
							<div>
								<strong>{activitySuccess === null ? "—" : `${activitySuccess}%`}</strong>
								<span>{t("dashboard.successful")}</span>
							</div>
						</div>
						<div className="activity-copy">
							<div>
								<span>{t("dashboard.requestsRetained")}</span>
								<strong>{formatNumber(status.activity.requests)}</strong>
							</div>
							<div>
								<span>{t("dashboard.errorResponses")}</span>
								<strong>{formatNumber(status.activity.errors)}</strong>
							</div>
							<div>
								<span>{t("dashboard.lastEvent")}</span>
								<strong>{formatDate(status.activity.last_event_at)}</strong>
							</div>
						</div>
					</div>
					<a className="text-link" href="#/logs">
						{t("dashboard.openLogs")} <Icon name="arrow" />
					</a>
				</Card>
			</div>

			<Card>
				<SectionHeader
					description={t("dashboard.keySectionBody")}
					title={t("dashboard.proxyKeys")}
				/>
				{proxyKeyError ? <InlineNotice tone="negative">{proxyKeyError}</InlineNotice> : null}
				{revealedKey ? (
					<InlineNotice tone="warning">
						<strong>{t("dashboard.copyNow")}</strong>{" "}
						{t("dashboard.copyNowBody")}
						<div className="secret-input one-time-key">
							<Icon name="key" />
							<input
								aria-label={t("dashboard.newProxyKey")}
								readOnly
								spellCheck={false}
								type={revealedKeyVisible ? "text" : "password"}
								value={revealedKey}
							/>
							<button
								onClick={() => setRevealedKeyVisible((visible) => !visible)}
								type="button"
							>
								{t(revealedKeyVisible ? "common.hide" : "common.show")}
							</button>
							<button onClick={() => void copyRevealedKey()} type="button">{t("common.copy")}</button>
							<button onClick={() => {
								setRevealedKey("");
								setRevealedKeyVisible(false);
							}} type="button">{t("common.dismiss")}</button>
						</div>
					</InlineNotice>
				) : null}
				<form className="key-create-row" onSubmit={(event) => void createProxyKey(event)}>
					<label className="field">
						<span>{t("dashboard.newKeyLabel")}</span>
						<input
							autoComplete="off"
							maxLength={80}
							name="proxy_key_label"
							onChange={(event) => setNewKeyLabel(event.target.value)}
							placeholder={t("dashboard.keyPlaceholder")}
							value={newKeyLabel}
						/>
					</label>
					<Button disabled={keyBusy || !newKeyLabel.trim()} type="submit" variant="primary">
						{t("dashboard.generateKey")}
					</Button>
				</form>
				{proxyKeyPhase === "loading" ? <p className="muted">{t("dashboard.loadingKeys")}</p> : null}
				{proxyKeyPhase === "ready" ? (
					<div className="table-wrap">
						<table>
							<caption className="visually-hidden">{t("dashboard.keyTable")}</caption>
							<thead>
								<tr>
									<th scope="col">{t("dashboard.label")}</th>
									<th scope="col">{t("dashboard.created")}</th>
									<th scope="col">{t("dashboard.lastChanged")}</th>
									<th scope="col"><span className="visually-hidden">{t("common.actions")}</span></th>
								</tr>
							</thead>
							<tbody>
								{proxyKeys.map((key) => (
									<tr key={key.id}>
										<td data-label={t("dashboard.label")}>
											<label className="visually-hidden" htmlFor={`proxy-label-${key.id}`}>
												{t("dashboard.labelFor", { label: key.label })}
											</label>
											<input
												id={`proxy-label-${key.id}`}
												maxLength={80}
												onChange={(event) => setKeyLabels((current) => ({
													...current,
													[key.id]: event.target.value,
												}))}
												value={keyLabels[key.id] ?? key.label}
											/>
											<code>{key.id.slice(0, 16)}…</code>
										</td>
										<td data-label={t("dashboard.created")}>{formatDate(key.created_at)}</td>
										<td data-label={t("dashboard.lastChanged")}>{formatDate(key.updated_at)}</td>
										<td className="table-action">
											<div className="button-row">
												<Button
													disabled={keyBusy || (keyLabels[key.id] ?? key.label) === key.label}
													onClick={() => void saveKeyLabel(key)}
													size="compact"
												>
													{t("dashboard.saveLabel")}
												</Button>
												<Button
													disabled={keyBusy}
													onClick={() => setPendingKeyAction({ action: "replace", key })}
													size="compact"
												>
													{t("dashboard.replace")}
												</Button>
												<Button
													disabled={keyBusy || proxyKeys.length <= 1}
													onClick={() => setPendingKeyAction({ action: "remove", key })}
													size="compact"
													variant="danger"
												>
													{t("dashboard.remove")}
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</Card>

			<Card>
				<SectionHeader
					actions={
						<div className="button-row">
							<Button
								disabled={updatePhase !== "idle"}
								icon="refresh"
								onClick={() => void checkUpdate()}
							>
								{updatePhase === "checking" ? t("common.checking") : t("dashboard.checkRelease")}
							</Button>
							{status.update.rollback_available ? (
								<Button
									disabled={updatePhase !== "idle"}
									onClick={() => setPendingAction("rollback")}
									variant="danger"
								>
									{t("dashboard.rollBack")}
								</Button>
							) : null}
						</div>
					}
					description={t("dashboard.updateRecoveryBody")}
					title={t("dashboard.updateRecovery")}
				/>
				{updateError ? <InlineNotice tone="negative">{updateError}</InlineNotice> : null}
				<div className="update-layout">
					<div className="update-posture">
						<div className="update-icon"><Icon name="server" /></div>
						<div>
							<span>{t("dashboard.installedVersion")}</span>
							<strong>v{status.service.version}</strong>
							<p>
								{status.update.install_supported
									? t("dashboard.binaryInstallAvailable")
									: t("dashboard.sourceInstallDisabled")}
							</p>
						</div>
					</div>
					{candidate ? (
						<div className="candidate-card">
							<div>
								<Badge tone={candidate.status === "available" ? "info" : "positive"}>
									{candidate.status === "available"
										? t("dashboard.updateAvailable")
										: t("dashboard.current")}
								</Badge>
								<h3>Pi Router v{candidate.latest_version}</h3>
								<p>
									{t("dashboard.published", {
										date: formatDate(candidate.published_at),
										size: formatBytes(candidate.asset.size),
									})}
								</p>
							</div>
							<div className="candidate-actions">
								<a
									className="button button-secondary button-default"
									href={candidate.release_url}
									rel="noreferrer"
									target="_blank"
								>
									<Icon name="external" /><span>{t("dashboard.releaseNotes")}</span>
								</a>
								{candidate.status === "available" && status.update.install_supported ? (
									<Button
										disabled={updatePhase !== "idle"}
										onClick={() => setPendingAction("install")}
										variant="primary"
									>
										{t("dashboard.installVersion", { version: candidate.latest_version })}
									</Button>
								) : null}
							</div>
						</div>
					) : (
						<div className="candidate-placeholder">
							<Icon name="clock" />
							<p>{t("dashboard.noReleaseCheck")}</p>
						</div>
					)}
				</div>
			</Card>

			<ConfirmDialog
				busy={updatePhase === "mutating"}
				confirmLabel={pendingAction === "install" ? t("dashboard.installConfirm") : t("dashboard.restoreBinary")}
				danger={pendingAction === "rollback"}
				description={
					pendingAction === "install"
						? t("dashboard.installBody", { version: candidate?.latest_version ?? "" })
						: t("dashboard.rollbackBody")
				}
				onCancel={() => setPendingAction(null)}
				onConfirm={() => void confirmMutation()}
				open={pendingAction !== null}
				title={pendingAction === "install" ? t("dashboard.installTitle") : t("dashboard.rollbackTitle")}
			/>
			<ConfirmDialog
				busy={keyBusy}
				confirmLabel={pendingKeyAction?.action === "replace" ? t("dashboard.replaceKey") : t("dashboard.removeKey")}
				danger
				description={
					pendingKeyAction?.action === "replace"
						? t("dashboard.replaceKeyBody", { label: pendingKeyAction.key.label })
						: t("dashboard.removeKeyBody", {
							label: pendingKeyAction?.key.label ?? t("dashboard.proxyKeys"),
						})
				}
				onCancel={() => setPendingKeyAction(null)}
				onConfirm={() => void mutateProxyKey()}
				open={pendingKeyAction !== null}
				title={pendingKeyAction?.action === "replace" ? t("dashboard.replaceKeyTitle") : t("dashboard.removeKeyTitle")}
			/>
		</>
	);
}
