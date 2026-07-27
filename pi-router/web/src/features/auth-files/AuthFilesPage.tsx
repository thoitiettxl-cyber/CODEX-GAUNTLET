import { useEffect, useMemo, useRef, useState } from "react";
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
	type CredentialInfo,
	type ManagementClient,
	type ManagementStatus,
} from "../../lib/api";
import styles from "./AuthFilesPage.module.scss";

const PAGE_SIZE = 6;
let credentialExportWarned = false;

export function AuthFilesPage({
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
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<CredentialInfo | null>(null);
	const [removing, setRemoving] = useState(false);
	const [filter, setFilter] = useState("");
	const [page, setPage] = useState(1);
	const [transferring, setTransferring] = useState(false);
	const input = useRef<HTMLInputElement>(null);

	const load = async () => {
		setPhase("loading");
		try {
			setCredentials(await client.credentials());
			setError("");
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			setPhase("error");
		}
	};

	useEffect(() => {
		void load();
	}, [client]);

	const filtered = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) {
			return credentials;
		}
		return credentials.filter((credential) => [
			credential.label,
			credential.account_id,
			credential.account_label,
			credential.provider_id,
			credential.provider_name,
			credential.type,
		].join(" ").toLowerCase().includes(needle));
	}, [credentials, filter]);
	const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	useEffect(() => {
		setPage(1);
	}, [filter]);
	useEffect(() => {
		setPage((current) => Math.min(current, pages));
	}, [pages]);

	const remove = async () => {
		if (!selected) {
			return;
		}
		setRemoving(true);
		try {
			await client.removeCredential(selected.id);
			notify(t("authFiles.removed", { label: selected.label }));
			setSelected(null);
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			notify(errorMessage(caught), "negative");
			setSelected(null);
		} finally {
			setRemoving(false);
		}
	};

	const warnExport = () => {
		if (!credentialExportWarned) {
			notify(t("authFiles.exportWarning"), "negative");
			credentialExportWarned = true;
		}
	};

	const exportOne = async (credential: CredentialInfo) => {
		warnExport();
		const blob = await client.exportCredentialFile(credential.id);
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${credential.account_id}-auth.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	};

	const exportBatch = async () => {
		setTransferring(true);
		try {
			const files = filtered.filter((credential, index, entries) =>
				entries.findIndex((entry) => entry.account_id === credential.account_id) === index);
			for (const credential of files) {
				await exportOne(credential);
			}
			notify(t("authFiles.exported", { count: files.length }));
		} catch (caught) {
			notify(errorMessage(caught), "negative");
		} finally {
			setTransferring(false);
		}
	};

	const importBatch = async (files: FileList | null) => {
		if (!files?.length) {
			return;
		}
		setTransferring(true);
		try {
			for (const file of files) {
				await client.importCredentialFile(file);
			}
			notify(t("authFiles.imported", { count: files.length }));
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			notify(errorMessage(caught), "negative");
		} finally {
			if (input.current) {
				input.current.value = "";
			}
			setTransferring(false);
		}
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={() => void load()}>{t("authFiles.refresh")}</Button>}
				description={t("authFiles.description")}
				eyebrow={t("authFiles.eyebrow")}
				title={t("authFiles.title")}
			/>
			<InlineNotice>
				<strong>{t("authFiles.boundaryTitle")}</strong>{" "}
				{t("authFiles.boundaryBody")}
			</InlineNotice>
			{!status.capabilities.credential_import_export ? (
				<InlineNotice tone="warning">{t("authFiles.transferUnavailable")}</InlineNotice>
			) : null}
			<Card>
				<SectionHeader
					actions={(
						<div className={styles.toolbar}>
							<SearchField
								label={t("authFiles.search")}
								onChange={setFilter}
								placeholder={t("authFiles.searchPlaceholder")}
								value={filter}
							/>
							<input
								accept="application/json,.json"
								hidden
								multiple
								onChange={(event) => void importBatch(event.target.files)}
								ref={input}
								type="file"
							/>
							<Button
								disabled={!status.capabilities.credential_import_export || transferring}
								onClick={() => input.current?.click()}
							>
								{t("authFiles.import")}
							</Button>
							<Button
								disabled={
									!status.capabilities.credential_import_export
									|| transferring
									|| filtered.length === 0
								}
								onClick={() => void exportBatch()}
							>
								{t("authFiles.exportBatch")}
							</Button>
							<a className="button button-primary button-default" href="#/oauth">
								<Icon name="login" /><span>{t("authFiles.add")}</span>
							</a>
						</div>
					)}
					description={t("authFiles.storedDescription")}
					title={t("authFiles.stored")}
				/>
				{phase === "loading" ? <LoadingState label={t("common.loading")} /> : null}
				{phase === "error" ? <ErrorState message={error} onRetry={() => void load()} /> : null}
				{phase === "ready" && credentials.length === 0 ? (
					<EmptyState
						action={(
							<a className="text-link" href="#/oauth">
								{t("authFiles.add")} <Icon name="arrow" />
							</a>
						)}
						description={t("authFiles.emptyBody")}
						icon="key"
						title={t("authFiles.empty")}
					/>
				) : null}
				{phase === "ready" && credentials.length > 0 && visible.length === 0 ? (
					<EmptyState
						description={t("authFiles.noMatchBody")}
						icon="search"
						title={t("authFiles.noMatch")}
					/>
				) : null}
				{phase === "ready" && visible.length > 0 ? (
					<>
						<div className="credential-grid">
							{visible.map((credential) => (
								<article className="credential-card" key={credential.id}>
									<div className="credential-icon"><Icon name="key" /></div>
									<div className="credential-main">
										<div>
											<h3>{credential.label}</h3>
											<code>{credential.provider_id}</code>
										</div>
										<div className="badge-row">
											<Badge tone={credential.active ? "positive" : "neutral"}>
												{credential.active
													? t("authFiles.inferenceAccount")
													: credential.account_label}
											</Badge>
											{credential.runtime_only ? (
												<Badge tone="warning">{t("authFiles.runtimeOnly")}</Badge>
											) : null}
											<code>{credential.account_id}</code>
										</div>
										<Badge tone={credential.type === "oauth" ? "info" : "neutral"}>
											{credential.type === "oauth"
												? t("authFiles.oauthCredential")
												: t("authFiles.apiKeyCredential")}
										</Badge>
										<p><Icon name="shield" />{t("authFiles.valueHidden")}</p>
										<div className={styles.advanced}>
											<strong>{t("authFiles.models")}</strong>
											{credential.models?.length ? (
												<div className={styles.models}>
													{credential.models.map((model) => <code key={model}>{model}</code>)}
												</div>
											) : <p>{t("authFiles.modelsUnavailable")}</p>}
											{credential.excluded_models?.length ? (
												<>
													<strong>{t("authFiles.excludedModels")}</strong>
													<div className={styles.models}>
														{credential.excluded_models.map((model) => (
															<code key={model}>{model}</code>
														))}
													</div>
												</>
											) : null}
											{credential.model_aliases
												&& Object.keys(credential.model_aliases).length > 0 ? (
													<>
														<strong>{t("authFiles.modelAliases")}</strong>
														<div className={styles.models}>
															{Object.entries(credential.model_aliases).map(([model, alias]) => (
																<code key={model}>{model} → {alias}</code>
															))}
														</div>
													</>
												) : null}
											{!credential.capabilities?.excluded_models
												|| !credential.capabilities?.model_aliases ? (
													<p>{t("authFiles.policyUnavailable")}</p>
												) : null}
										</div>
									</div>
									<div className="button-row">
										<Button
											disabled={
												!status.capabilities.credential_import_export
												|| transferring
											}
											onClick={() => {
												setTransferring(true);
												void exportOne(credential)
													.catch((caught) =>
														notify(errorMessage(caught), "negative"))
													.finally(() => setTransferring(false));
											}}
										>
											{t("authFiles.export")}
										</Button>
										<Button
											aria-label={`${t("authFiles.logout")} ${credential.label}`}
											onClick={() => setSelected(credential)}
											variant="danger"
										>
											{t("authFiles.logout")}
										</Button>
									</div>
								</article>
							))}
						</div>
						{pages > 1 ? (
							<div className={styles.pagination}>
								<Button
									disabled={page <= 1}
									onClick={() => setPage((current) => current - 1)}
									size="compact"
								>
									{t("authFiles.previous")}
								</Button>
								<span>{t("authFiles.page", { page, pages })}</span>
								<Button
									disabled={page >= pages}
									onClick={() => setPage((current) => current + 1)}
									size="compact"
								>
									{t("authFiles.next")}
								</Button>
							</div>
						) : null}
					</>
				) : null}
			</Card>
			<ConfirmDialog
				busy={removing}
				confirmLabel={t("authFiles.logoutConfirm")}
				danger
				description={`${selected?.label ?? ""} · ${selected?.account_label ?? ""}`}
				onCancel={() => setSelected(null)}
				onConfirm={() => void remove()}
				open={selected !== null}
				title={t("authFiles.logoutTitle")}
			/>
		</>
	);
}
