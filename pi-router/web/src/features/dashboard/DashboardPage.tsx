import { useEffect, useState, type FormEvent } from "react";

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
			setNewKeyLabel("");
			await Promise.all([loadProxyKeys(), onRefreshStatus()]);
			notify("Proxy API key created. Copy its value now; it will not be shown again.");
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
			notify("Proxy API-key label updated.");
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
				notify("Proxy API key replaced. Existing clients must use the new value.");
			} else {
				await client.removeProxyKey(pendingKeyAction.key.id);
				notify("Proxy API key removed.");
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
			notify("Proxy API key copied.");
		} catch {
			notify("Could not copy the proxy API key.", "negative");
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
				notify(`Version ${candidate.latest_version} installed. Restart Pi Router to activate it.`);
			} else if (pendingAction === "rollback") {
				await client.rollbackUpdate();
				notify("Previous verified binary restored. Restart Pi Router to activate it.");
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
				actions={<Button icon="refresh" onClick={() => void onRefreshStatus()}>Refresh status</Button>}
				description="A bounded view of the local gateway, active account, operational activity, and recovery posture."
				eyebrow="Operate"
				title="Dashboard"
			/>

			{status.update.restart_required ? (
				<InlineNotice tone="warning">
					<strong>Restart required.</strong> Version {status.update.pending_version ?? "change"} is
					pending activation; this console cannot restart the process.
				</InlineNotice>
			) : null}
			<InlineNotice tone="positive">
				<strong>{status.connection.status === "connected" ? "Connected" : "Unavailable"}.</strong>{" "}
				Management authentication is separate from the {status.authentication.proxy_api_keys} proxy
				API key{status.authentication.proxy_api_keys === 1 ? "" : "s"} accepted by inference clients.
			</InlineNotice>

			<div className="stat-grid">
				<StatCard
					detail={`Server v${status.service.version} · ${formatUptime(status.service.uptime_seconds)} uptime`}
					icon="server"
					label="Connection"
					tone="positive"
					value={status.connection.status}
				/>
				<StatCard
					detail={`${status.account.configured_providers} configured of ${status.account.providers}`}
					icon="providers"
					label="AI providers"
					value={formatNumber(status.account.providers)}
				/>
				<StatCard
					detail={`${status.account.stored_credentials} stored credential metadata records`}
					icon="server"
					label="Available models"
					tone="positive"
					value={formatNumber(status.account.available_models)}
				/>
				<StatCard
					detail="Managed independently from the management key"
					icon="key"
					label="Proxy API keys"
					value={formatNumber(status.authentication.proxy_api_keys)}
				/>
				<StatCard
					detail={`${status.activity.errors} errors in the in-memory buffer`}
					icon="logs"
					label="Recorded activity"
					tone={status.activity.errors > 0 ? "warning" : "default"}
					value={formatNumber(status.activity.requests)}
				/>
				<StatCard
					detail={`${status.quota.supported_providers} reviewed adapters of ${status.quota.total_providers}`}
					icon="quota"
					label="Quota coverage"
					value={formatNumber(status.quota.supported_providers)}
				/>
			</div>

			<div className="dashboard-grid">
				<Card>
					<SectionHeader
						description="Current process identity. Values are bounded and contain no raw state paths."
						title="Runtime posture"
					/>
					<dl className="detail-list">
						<div>
							<dt>Service</dt>
							<dd>
								<span className="health-dot" />
								{status.service.name} v{status.service.version}
							</dd>
						</div>
						<div>
							<dt>Uptime</dt>
							<dd>{formatUptime(status.service.uptime_seconds)}</dd>
						</div>
						<div>
							<dt>Selected account</dt>
							<dd><code>{status.account.id}</code></dd>
						</div>
						<div>
							<dt>Runtime</dt>
							<dd>{status.runtime.mode} · Node {status.runtime.node}</dd>
						</div>
						<div>
							<dt>Platform</dt>
							<dd>{status.runtime.platform} / {status.runtime.arch}</dd>
						</div>
						<div>
							<dt>Configuration</dt>
							<dd>
								<Badge tone={status.config.state === "ready" ? "positive" : "warning"}>
									{status.config.state}
								</Badge>
								{status.config.recovery_available ? "Recovery available" : "No recovery snapshot"}
							</dd>
						</div>
					</dl>
				</Card>

				<Card>
					<SectionHeader
						description="Recent counts from the sanitized process-memory event buffer."
						title="Activity summary"
					/>
					<div className="activity-visual">
						<div
							aria-label={
								activitySuccess === null
									? "No requests retained"
									: `${activitySuccess} percent successful`
							}
							className={`activity-ring activity-ring-${activityStep}`}
							role="img"
						>
							<div>
								<strong>{activitySuccess === null ? "—" : `${activitySuccess}%`}</strong>
								<span>successful</span>
							</div>
						</div>
						<div className="activity-copy">
							<div>
								<span>Requests retained</span>
								<strong>{formatNumber(status.activity.requests)}</strong>
							</div>
							<div>
								<span>Error responses</span>
								<strong>{formatNumber(status.activity.errors)}</strong>
							</div>
							<div>
								<span>Last event</span>
								<strong>{formatDate(status.activity.last_event_at)}</strong>
							</div>
						</div>
					</div>
					<a className="text-link" href="#logs">
						Open sanitized logs <Icon name="arrow" />
					</a>
				</Card>
			</div>

			<Card>
				<SectionHeader
					description="These keys authenticate /v1 clients only. Values are generated server-side and disclosed once on create or replace."
					title="Proxy API keys"
				/>
				{proxyKeyError ? <InlineNotice tone="negative">{proxyKeyError}</InlineNotice> : null}
				{revealedKey ? (
					<InlineNotice tone="warning">
						<strong>Copy this key now.</strong> It will disappear when you dismiss it or
						reload the page.
						<div className="secret-input one-time-key">
							<Icon name="key" />
							<input
								aria-label="New proxy API key"
								readOnly
								spellCheck={false}
								type="text"
								value={revealedKey}
							/>
							<button onClick={() => void copyRevealedKey()} type="button">Copy</button>
							<button onClick={() => setRevealedKey("")} type="button">Dismiss</button>
						</div>
					</InlineNotice>
				) : null}
				<form className="key-create-row" onSubmit={(event) => void createProxyKey(event)}>
					<label className="field">
						<span>New key label</span>
						<input
							autoComplete="off"
							maxLength={80}
							name="proxy_key_label"
							onChange={(event) => setNewKeyLabel(event.target.value)}
							placeholder="Codex on this device"
							value={newKeyLabel}
						/>
					</label>
					<Button disabled={keyBusy || !newKeyLabel.trim()} type="submit" variant="primary">
						Generate proxy key
					</Button>
				</form>
				{proxyKeyPhase === "loading" ? <p className="muted">Loading proxy API-key metadata…</p> : null}
				{proxyKeyPhase === "ready" ? (
					<div className="table-wrap">
						<table>
							<caption className="visually-hidden">Proxy API-key metadata</caption>
							<thead>
								<tr>
									<th scope="col">Label</th>
									<th scope="col">Created</th>
									<th scope="col">Last changed</th>
									<th scope="col"><span className="visually-hidden">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{proxyKeys.map((key) => (
									<tr key={key.id}>
										<td data-label="Label">
											<label className="visually-hidden" htmlFor={`proxy-label-${key.id}`}>
												Label for {key.label}
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
										<td data-label="Created">{formatDate(key.created_at)}</td>
										<td data-label="Last changed">{formatDate(key.updated_at)}</td>
										<td className="table-action">
											<div className="button-row">
												<Button
													disabled={keyBusy || (keyLabels[key.id] ?? key.label) === key.label}
													onClick={() => void saveKeyLabel(key)}
													size="compact"
												>
													Save label
												</Button>
												<Button
													disabled={keyBusy}
													onClick={() => setPendingKeyAction({ action: "replace", key })}
													size="compact"
												>
													Replace
												</Button>
												<Button
													disabled={keyBusy || proxyKeys.length <= 1}
													onClick={() => setPendingKeyAction({ action: "remove", key })}
													size="compact"
													variant="danger"
												>
													Remove
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
								{updatePhase === "checking" ? "Checking…" : "Check stable release"}
							</Button>
							{status.update.rollback_available ? (
								<Button
									disabled={updatePhase !== "idle"}
									onClick={() => setPendingAction("rollback")}
									variant="danger"
								>
									Roll back
								</Button>
							) : null}
						</div>
					}
					description="Release discovery is explicit. Install and rollback keep the existing verified recovery boundary."
					title="Update & recovery"
				/>
				{updateError ? <InlineNotice tone="negative">{updateError}</InlineNotice> : null}
				<div className="update-layout">
					<div className="update-posture">
						<div className="update-icon"><Icon name="server" /></div>
						<div>
							<span>Installed version</span>
							<strong>v{status.service.version}</strong>
							<p>
								{status.update.install_supported
									? "Native Termux binary; verified install is available."
									: "Source mode; release checks are available but install is disabled."}
							</p>
						</div>
					</div>
					{candidate ? (
						<div className="candidate-card">
							<div>
								<Badge tone={candidate.status === "available" ? "info" : "positive"}>
									{candidate.status === "available" ? "Update available" : "Current"}
								</Badge>
								<h3>Pi Router v{candidate.latest_version}</h3>
								<p>
									Published {formatDate(candidate.published_at)} · {formatBytes(candidate.asset.size)}
								</p>
							</div>
							<div className="candidate-actions">
								<a
									className="button button-secondary button-default"
									href={candidate.release_url}
									rel="noreferrer"
									target="_blank"
								>
									<Icon name="external" /><span>Release notes</span>
								</a>
								{candidate.status === "available" && status.update.install_supported ? (
									<Button
										disabled={updatePhase !== "idle"}
										onClick={() => setPendingAction("install")}
										variant="primary"
									>
										Install v{candidate.latest_version}
									</Button>
								) : null}
							</div>
						</div>
					) : (
						<div className="candidate-placeholder">
							<Icon name="clock" />
							<p>No release check has run in this page session.</p>
						</div>
					)}
				</div>
			</Card>

			<ConfirmDialog
				busy={updatePhase === "mutating"}
				confirmLabel={pendingAction === "install" ? "Install verified binary" : "Restore previous binary"}
				danger={pendingAction === "rollback"}
				description={
					pendingAction === "install"
						? `Install v${candidate?.latest_version ?? ""} after fresh checksum and Android AArch64 validation? The running process will still require restart.`
						: "Replace the installed binary with its retained verified predecessor? The running process will still require restart."
				}
				onCancel={() => setPendingAction(null)}
				onConfirm={() => void confirmMutation()}
				open={pendingAction !== null}
				title={pendingAction === "install" ? "Install stable update?" : "Roll back Pi Router?"}
			/>
			<ConfirmDialog
				busy={keyBusy}
				confirmLabel={pendingKeyAction?.action === "replace" ? "Replace key" : "Remove key"}
				danger
				description={
					pendingKeyAction?.action === "replace"
						? `Replace ${pendingKeyAction.key.label}? Its current value stops working immediately and the new value is shown once.`
						: `Remove ${pendingKeyAction?.key.label ?? "this key"}? Clients using it will lose inference access.`
				}
				onCancel={() => setPendingKeyAction(null)}
				onConfirm={() => void mutateProxyKey()}
				open={pendingKeyAction !== null}
				title={pendingKeyAction?.action === "replace" ? "Replace proxy API key?" : "Remove proxy API key?"}
			/>
		</>
	);
}
