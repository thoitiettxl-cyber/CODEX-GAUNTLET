import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Badge,
	Button,
	Card,
	ConfirmDialog,
	EmptyState,
	InlineNotice,
	LoadingState,
	PageHeader,
	SectionHeader,
} from "../../components/ui";
import { Icon } from "../../components/ui/Icon";
import {
	errorMessage,
	type ManagementClient,
	type ManagementStatus,
	type ModelInfo,
	type UpdateCandidate,
} from "../../lib/api";
import { useAuthStore, hasRememberedLogin } from "../../stores/auth";
import styles from "./SystemPage.module.scss";

const LINKS = [
	{
		key: "system.productContract",
		href: "https://github.com/thoitiettxl-cyber/codex-gauntlet-termux/blob/rtk/docs/product/pi-router.md",
	},
	{
		key: "system.runbook",
		href: "https://github.com/thoitiettxl-cyber/codex-gauntlet-termux/blob/rtk/docs/runbooks/pi-router.md",
	},
	{
		key: "system.sourceRepository",
		href: "https://github.com/thoitiettxl-cyber/codex-gauntlet-termux",
	},
] as const;

export function SystemPage({
	client,
	status,
	notify,
}: {
	client: ManagementClient;
	status: ManagementStatus;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const clearLocalLogin = useAuthStore((state) => state.clearLocalLogin);
	const remember = useAuthStore((state) => state.remember);
	const [candidate, setCandidate] = useState<UpdateCandidate | null>(null);
	const [checkingUpdate, setCheckingUpdate] = useState(false);
	const [proxyKey, setProxyKey] = useState("");
	const [showProxyKey, setShowProxyKey] = useState(false);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [modelPhase, setModelPhase] = useState<"idle" | "loading" | "ready">("idle");
	const [modelError, setModelError] = useState("");
	const [confirmClear, setConfirmClear] = useState(false);
	const remembered = remember && hasRememberedLogin();
	const groupedModels = useMemo(() => {
		const groups = new Map<string, ModelInfo[]>();
		for (const model of models) {
			const group = groups.get(model.owned_by) ?? [];
			group.push(model);
			groups.set(model.owned_by, group);
		}
		return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
	}, [models]);

	const checkUpdate = async () => {
		setCheckingUpdate(true);
		try {
			const result = await client.checkUpdate();
			setCandidate(result);
			notify(
				result.status === "available"
					? t("system.updateAvailable", { version: result.latest_version })
					: t("system.upToDate"),
			);
		} catch (error) {
			notify(errorMessage(error), "negative");
		} finally {
			setCheckingUpdate(false);
		}
	};

	const fetchModels = async () => {
		if (!proxyKey.trim()) {
			return;
		}
		setModelPhase("loading");
		setModelError("");
		try {
			setModels(await client.models(proxyKey.trim()));
			setModelPhase("ready");
		} catch (error) {
			setModels([]);
			setModelError(errorMessage(error));
			setModelPhase("ready");
		}
	};

	const clearLogin = () => {
		clearLocalLogin();
		setConfirmClear(false);
		notify(t("system.cleared"));
	};

	return (
		<>
			<PageHeader
				actions={(
					<Button
						disabled={checkingUpdate}
						icon="refresh"
						onClick={() => void checkUpdate()}
					>
						{checkingUpdate ? t("common.checking") : t("system.checkUpdate")}
					</Button>
				)}
				description={t("system.description")}
				eyebrow={t("system.eyebrow")}
				title={t("system.title")}
			/>

			<Card>
				<SectionHeader title={t("system.about")} />
				<div className={styles.runtimeGrid}>
					<div className={styles.runtimeTile}>
						<span>{t("system.uiVersion")}</span>
						<strong>v{__PI_ROUTER_UI_VERSION__}</strong>
					</div>
					<div className={styles.runtimeTile}>
						<span>{t("system.serverVersion")}</span>
						<strong>v{status.service.version}</strong>
						{candidate?.status === "available" ? (
							<Badge tone="warning">v{candidate.latest_version}</Badge>
						) : null}
					</div>
					<div className={styles.runtimeTile}>
						<span>{t("system.runtime")}</span>
						<strong>{status.runtime.mode} · Node {status.runtime.node}</strong>
					</div>
					<div className={styles.runtimeTile}>
						<span>{t("system.connection")}</span>
						<strong>{t("app.connected")}</strong>
					</div>
				</div>
			</Card>

			<div className={styles.grid}>
				<Card>
					<SectionHeader title={t("system.quickLinks")} />
					<div className={styles.links}>
						{LINKS.map((link) => (
							<a
								className={styles.link}
								href={link.href}
								key={link.key}
								rel="noreferrer"
								target="_blank"
							>
								<Icon name="external" />
								<strong>{t(link.key)}</strong>
								<Icon name="arrow" />
							</a>
						))}
					</div>
				</Card>
				<Card>
					<div className={styles.settingRow}>
						<div>
							<SectionHeader title={t("system.requestLogging")} />
							<p>{t("system.requestLoggingBody")}</p>
						</div>
						<div className="button-row">
							<Badge tone={status.activity.enabled ? "positive" : "neutral"}>
								{status.activity.enabled
									? t("system.loggingEnabled")
									: t("system.loggingDisabled")}
							</Badge>
							<a className="button button-default" href="#/config">
								{t("system.editLogging")}
							</a>
						</div>
					</div>
				</Card>
			</div>

			<Card>
				<SectionHeader
					description={t("system.modelsBody")}
					title={t("system.models")}
				/>
				<div className={styles.modelForm}>
					<label className="field">
						<span>{t("system.proxyKey")}</span>
						<div className="secret-input">
							<Icon name="key" />
							<input
								autoComplete="off"
								name="system_proxy_key"
								onChange={(event) => setProxyKey(event.target.value)}
								placeholder={t("system.proxyKeyPlaceholder")}
								spellCheck={false}
								type={showProxyKey ? "text" : "password"}
								value={proxyKey}
							/>
							<button onClick={() => setShowProxyKey((value) => !value)} type="button">
								{showProxyKey ? t("common.hide") : t("common.show")}
							</button>
						</div>
					</label>
					<Button
						disabled={!proxyKey.trim() || modelPhase === "loading"}
						onClick={() => void fetchModels()}
						variant="primary"
					>
						{modelPhase === "loading" ? t("system.modelsLoading") : t("system.fetchModels")}
					</Button>
				</div>
				{modelPhase === "loading" ? <LoadingState label={t("system.modelsLoading")} /> : null}
				{modelError ? <InlineNotice tone="negative">{modelError}</InlineNotice> : null}
				{modelPhase === "ready" && !modelError && models.length === 0 ? (
					<EmptyState
						description={t("system.modelsEmpty")}
						icon="providers"
						title={t("system.models")}
					/>
				) : null}
				{models.length > 0 ? (
					<>
						<InlineNotice tone="positive">
							{t("system.modelsCount", {
								count: models.length,
								providers: groupedModels.length,
							})}
						</InlineNotice>
						<div className={styles.modelGroups}>
							{groupedModels.map(([provider, entries]) => (
								<section className={styles.modelGroup} key={provider}>
									<Badge tone="info">{provider}</Badge>
									<ul>
										{entries.map((model) => <li key={model.id}><code>{model.id}</code></li>)}
									</ul>
								</section>
							))}
						</div>
					</>
				) : null}
			</Card>

			<Card>
				<div className={styles.settingRow}>
					<div>
						<SectionHeader title={t("system.localData")} />
						<p>{t("system.localDataBody")}</p>
						<Badge tone={remembered ? "warning" : "positive"}>
							{remembered ? t("system.remembered") : t("system.notRemembered")}
						</Badge>
					</div>
					<Button
						disabled={!remembered}
						onClick={() => setConfirmClear(true)}
						variant="danger"
					>
						{t("system.clearLogin")}
					</Button>
				</div>
			</Card>

			<ConfirmDialog
				confirmLabel={t("system.clearConfirm")}
				danger
				description={t("system.clearBody")}
				onCancel={() => setConfirmClear(false)}
				onConfirm={clearLogin}
				open={confirmClear}
				title={t("system.clearTitle")}
			/>
		</>
	);
}
