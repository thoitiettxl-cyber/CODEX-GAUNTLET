import { useState } from "react";

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
	type UpdateCandidate,
} from "../../lib/api";
import {
	formatBytes,
	formatDate,
	formatNumber,
	formatUptime,
} from "../../lib/format";

type PendingAction = "install" | "rollback" | null;

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

			<div className="stat-grid">
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
		</>
	);
}
