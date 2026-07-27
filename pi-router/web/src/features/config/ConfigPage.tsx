import { yaml } from "@codemirror/lang-yaml";
import { MergeView } from "@codemirror/merge";
import CodeMirror, {
	EditorView,
	getDefaultExtensions,
} from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LineCounter, parseDocument } from "yaml";

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
	SectionHeader,
} from "../../components/ui";
import { cspNonce } from "../../lib/csp";
import {
	errorMessage,
	type ManagementClient,
	type ManagementStatus,
	type RawConfigState,
} from "../../lib/api";
import { usePreferenceStore } from "../../stores/preferences";
import styles from "./ConfigPage.module.scss";

function parsedYaml(source: string, invalidMapping: string, yamlError: (
	line: number,
	column: number,
	message: string,
) => string): Record<string, unknown> {
	const lineCounter = new LineCounter();
	const document = parseDocument(source, { lineCounter, prettyErrors: false });
	const issue = document.errors[0];
	if (issue) {
		const position = issue.pos[0] === undefined
			? { line: 1, col: 1 }
			: lineCounter.linePos(issue.pos[0]);
		throw new Error(yamlError(position.line, position.col, issue.message));
	}
	const value: unknown = document.toJS({ maxAliasCount: 100 });
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(invalidMapping);
	}
	return value as Record<string, unknown>;
}

function SourceDiff({ original, modified }: { original: string; modified: string }) {
	const host = useRef<HTMLDivElement>(null);
	const theme = usePreferenceStore((state) => state.theme);
	const editorTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	const nonce = cspNonce();

	useEffect(() => {
		if (!host.current) {
			return;
		}
		const extensions = [
			...getDefaultExtensions({
				basicSetup: true,
				editable: false,
				readOnly: true,
				theme: editorTheme,
			}),
			yaml(),
			EditorView.lineWrapping,
			EditorView.cspNonce.of(nonce),
		];
		const view = new MergeView({
			a: { doc: original, extensions },
			b: { doc: modified, extensions },
			parent: host.current,
			orientation: "a-b",
			highlightChanges: true,
			gutter: true,
			collapseUnchanged: { margin: 3, minSize: 6 },
		});
		return () => view.destroy();
	}, [editorTheme, modified, nonce, original, theme]);

	return <div className={styles.merge} ref={host} />;
}

export function ConfigPage({
	client,
	status,
	onMutation,
	onDirtyChange,
	notify,
}: {
	client: ManagementClient;
	status: ManagementStatus;
	onMutation: () => Promise<void>;
	onDirtyChange: (dirty: boolean) => void;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [config, setConfig] = useState<RawConfigState | null>(null);
	const [draft, setDraft] = useState("");
	const [previewSource, setPreviewSource] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const original = config?.source ?? "";
	const dirty = Boolean(config && draft !== original);
	const editorTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	const extensions = useMemo(
		() => [yaml(), EditorView.lineWrapping, EditorView.cspNonce.of(cspNonce())],
		[],
	);

	const parse = (source: string) => parsedYaml(
		source,
		t("config.yamlMappingError"),
		(line, column, message) => t("config.yamlError", { line, column, message }),
	);

	const load = async () => {
		if (!status.capabilities.raw_config) {
			setPhase("ready");
			return;
		}
		setPhase("loading");
		setError("");
		try {
			const next = await client.rawConfig();
			setConfig(next);
			setDraft(next.source);
			setPreviewSource("");
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			setPhase("error");
		}
	};

	useEffect(() => {
		void load();
	}, [client, status.capabilities.raw_config]);

	useEffect(() => {
		onDirtyChange(dirty);
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (dirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			onDirtyChange(false);
		};
	}, [dirty, onDirtyChange]);

	const changeDraft = (value: string) => {
		setDraft(value);
		setPreviewSource("");
		setError("");
	};

	const preview = () => {
		setError("");
		try {
			parse(draft);
			setPreviewSource(draft);
		} catch (caught) {
			setPreviewSource("");
			setError(errorMessage(caught));
		}
	};

	const lockoutRisk = () => {
		const before = parse(original);
		const after = parse(draft);
		const beforeEnvironment = before.environment as Record<string, unknown> | undefined;
		const afterEnvironment = after.environment as Record<string, unknown> | undefined;
		return JSON.stringify({
			host: before.host,
			port: before.port,
			remote: before["remote-management"],
			managementEnvironment: beforeEnvironment?.PI_ROUTER_MANAGEMENT_KEY,
		}) !== JSON.stringify({
			host: after.host,
			port: after.port,
			remote: after["remote-management"],
			managementEnvironment: afterEnvironment?.PI_ROUTER_MANAGEMENT_KEY,
		});
	};

	const apply = async () => {
		setBusy(true);
		setError("");
		try {
			const result = await client.putRawConfig(draft);
			notify(result.restart_required ? t("config.appliedRestart") : t("config.applied"));
			setConfirm(false);
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			setError(errorMessage(caught));
			setConfirm(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={() => void load()}>{t("config.reload")}</Button>}
				description={t("config.description")}
				eyebrow={t("config.eyebrow")}
				title={t("config.title")}
			/>
			<InlineNotice tone="warning">
				<strong>{t("config.rawTitle")}</strong>{" "}
				{t("config.rawBody")}
			</InlineNotice>

			{phase === "loading" ? <Card><LoadingState label={t("common.loading")} /></Card> : null}
			{phase === "error" ? <Card><ErrorState message={error} onRetry={() => void load()} /></Card> : null}
			{phase === "ready" && !status.capabilities.raw_config ? (
				<Card>
					<EmptyState
						description={t("config.unsupportedBody")}
						icon="config"
						title={t("config.unsupported")}
					/>
				</Card>
			) : null}
			{phase === "ready" && config ? (
				<div className={styles.layout}>
					<Card className={styles.editorCard}>
						<SectionHeader
							actions={(
								<div className="button-row">
									<Badge tone={dirty ? "warning" : "positive"}>
										{dirty ? t("config.unsaved") : t("config.inSync")}
									</Badge>
									<Button
										disabled={!dirty || busy}
										onClick={() => changeDraft(original)}
										size="compact"
									>
										{t("config.reset")}
									</Button>
								</div>
							)}
							description={t("config.sourceDescription")}
							title={t("config.source")}
						/>
						<div className={styles.editor}>
							<CodeMirror
								aria-label={t("config.source")}
								basicSetup={{
									lineNumbers: true,
									highlightActiveLine: true,
									highlightSelectionMatches: true,
									searchKeymap: true,
									foldGutter: true,
									bracketMatching: true,
								}}
								extensions={extensions}
								height="36rem"
								onChange={changeDraft}
								theme={editorTheme}
								value={draft}
							/>
						</div>
						<div className={styles.footer}>
							<span>{t("config.revision")} <code>{config.revision.slice(0, 12)}…</code></span>
							<span>{t("config.bytes", { count: new Blob([draft]).size })}</span>
						</div>
						{error ? <InlineNotice tone="negative">{error}</InlineNotice> : null}
						<div className={styles.actions}>
							<span className="muted">{t("config.rawRecovery")}</span>
							<div className="button-row">
								<Button disabled={!dirty || busy} icon="shield" onClick={preview}>
									{t("config.preview")}
								</Button>
								<Button
									disabled={!previewSource || previewSource !== draft || busy}
									onClick={() => setConfirm(true)}
									variant="primary"
								>
									{t("config.apply")}
								</Button>
							</div>
						</div>
					</Card>

					<Card className={styles.diffCard}>
						<SectionHeader description={t("config.diffDescription")} title={t("config.diff")} />
						{!previewSource ? (
							<EmptyState
								description={t("config.noPreviewBody")}
								icon="shield"
								title={t("config.noPreview")}
							/>
						) : (
							<>
								<InlineNotice tone="positive">{t("config.validRaw")}</InlineNotice>
								<div className={styles.diffLabels}>
									<span>{t("config.before")}</span>
									<span>{t("config.after")}</span>
								</div>
								<SourceDiff modified={previewSource} original={original} />
							</>
						)}
					</Card>
				</div>
			) : null}

			<ConfirmDialog
				busy={busy}
				confirmLabel={t("config.applyConfirm")}
				danger={confirm && lockoutRisk()}
				description={confirm && lockoutRisk() ? t("config.lockoutBody") : t("config.applyBody")}
				onCancel={() => setConfirm(false)}
				onConfirm={() => void apply()}
				open={confirm}
				title={confirm && lockoutRisk() ? t("config.lockoutTitle") : t("config.applyTitle")}
			/>
		</>
	);
}
