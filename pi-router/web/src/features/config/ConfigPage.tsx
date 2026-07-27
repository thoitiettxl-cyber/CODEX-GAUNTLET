import { yaml } from "@codemirror/lang-yaml";
import { MergeView } from "@codemirror/merge";
import CodeMirror, {
	EditorView,
	getDefaultExtensions,
} from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LineCounter, parseDocument, stringify } from "yaml";

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
	type ConfigPreview,
	type ConfigState,
	type ManagementClient,
} from "../../lib/api";
import { usePreferenceStore } from "../../stores/preferences";
import styles from "./ConfigPage.module.scss";

type ConfirmAction = "apply" | "restore" | null;

function asDocument(
	value: unknown,
	invalidMessage: string,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(invalidMessage);
	}
	return value as Record<string, unknown>;
}

function yamlSource(document: Record<string, unknown>): string {
	return stringify(document, {
		indent: 2,
		lineWidth: 100,
		minContentWidth: 0,
	});
}

function SourceDiff({
	original,
	modified,
}: {
	original: string;
	modified: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	const theme = usePreferenceStore((state) => state.theme);
	const editorTheme = document.documentElement.dataset.theme === "dark"
		? "dark"
		: "light";
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
	onMutation,
	onDirtyChange,
	notify,
}: {
	client: ManagementClient;
	onMutation: () => Promise<void>;
	onDirtyChange: (dirty: boolean) => void;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const { t } = useTranslation();
	const theme = usePreferenceStore((state) => state.theme);
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [config, setConfig] = useState<ConfigState | null>(null);
	const [draft, setDraft] = useState("");
	const [previewSource, setPreviewSource] = useState("");
	const [preview, setPreview] = useState<ConfigPreview | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmAction>(null);
	const original = useMemo(
		() => config?.document ? yamlSource(config.document) : "",
		[config],
	);
	const dirty = Boolean(config?.editable && draft !== original);
	const editorTheme = document.documentElement.dataset.theme === "dark"
		? "dark"
		: "light";
	const extensions = useMemo(
		() => [yaml(), EditorView.lineWrapping, EditorView.cspNonce.of(cspNonce())],
		[],
	);

	const load = async () => {
		setPhase("loading");
		setError("");
		try {
			const next = await client.getConfig();
			setConfig(next);
			setDraft(next.document ? yamlSource(next.document) : "");
			setPreviewSource("");
			setPreview(null);
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			setPhase("error");
		}
	};

	useEffect(() => {
		void load();
	}, [client]);

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
		setPreview(null);
		setError("");
	};

	const parse = (): Record<string, unknown> => {
		const lineCounter = new LineCounter();
		const document = parseDocument(draft, {
			lineCounter,
			prettyErrors: false,
		});
		const issue = document.errors[0];
		if (issue) {
			const position = issue.pos[0] === undefined
				? { line: 1, col: 1 }
				: lineCounter.linePos(issue.pos[0]);
			throw new Error(t("config.yamlError", {
				line: position.line,
				column: position.col,
				message: issue.message,
			}));
		}
		return asDocument(document.toJS(), t("config.yamlMappingError"));
	};

	const runPreview = async () => {
		setBusy(true);
		setError("");
		try {
			const parsed = parse();
			const result = await client.previewConfig(parsed);
			setPreview(result);
			setPreviewSource(draft);
		} catch (caught) {
			setPreview(null);
			setPreviewSource("");
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const apply = async () => {
		if (!preview?.valid || !preview.revision) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await client.applyConfig(parse(), preview.revision);
			notify(result.restart_required ? t("config.appliedRestart") : t("config.applied"));
			setConfirm(null);
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			setError(errorMessage(caught));
			setConfirm(null);
		} finally {
			setBusy(false);
		}
	};

	const restore = async () => {
		if (!config?.revision) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await client.restoreConfig(config.revision);
			notify(result.restart_required ? t("config.restoredRestart") : t("config.restored"));
			setConfirm(null);
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			setError(errorMessage(caught));
			setConfirm(null);
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
			<InlineNotice>
				<strong>{t("config.safeTitle")}</strong>{" "}
				{t("config.safeBody")}
			</InlineNotice>

			{phase === "loading" ? <Card><LoadingState label={t("common.loading")} /></Card> : null}
			{phase === "error" ? (
				<Card><ErrorState message={error} onRetry={() => void load()} /></Card>
			) : null}
			{phase === "ready" && config && !config.supported ? (
				<Card>
					<EmptyState
						description={t("config.unsupportedBody")}
						icon="config"
						title={t("config.unsupported")}
					/>
				</Card>
			) : null}
			{phase === "ready" && config?.supported && !config.editable ? (
				<Card>
					<ErrorState message={t("config.notEditable")} onRetry={() => void load()} />
					{config.errors.length ? (
						<ul className={styles.validation}>
							{config.errors.map((item, index) => (
								<li key={`${item.path}-${index}`}>
									<code>{item.path}</code>
									<span>{item.message}</span>
								</li>
							))}
						</ul>
					) : null}
				</Card>
			) : null}
			{phase === "ready" && config?.editable ? (
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
							<span>{t("config.revision")} <code>{config.revision?.slice(0, 12)}…</code></span>
							<span>{t("config.bytes", { count: new Blob([draft]).size })}</span>
						</div>
						{error ? <InlineNotice tone="negative">{error}</InlineNotice> : null}
						<div className={styles.actions}>
							{config.recovery_available ? (
								<Button
									disabled={busy}
									onClick={() => setConfirm("restore")}
									variant="danger"
								>
									{t("config.restore")}
								</Button>
							) : <span className="muted">{t("config.noRecovery")}</span>}
							<div className="button-row">
								<Button
									disabled={!dirty || busy}
									icon="shield"
									onClick={() => void runPreview()}
								>
									{busy ? t("config.validating") : t("config.preview")}
								</Button>
								<Button
									disabled={!preview?.valid || !preview.changed || busy}
									onClick={() => setConfirm("apply")}
									variant="primary"
								>
									{t("config.apply")}
								</Button>
							</div>
						</div>
					</Card>

					<Card className={styles.diffCard}>
						<SectionHeader
							description={t("config.diffDescription")}
							title={t("config.diff")}
						/>
						{!preview ? (
							<EmptyState
								description={t("config.noPreviewBody")}
								icon="shield"
								title={t("config.noPreview")}
							/>
						) : null}
						{preview && !preview.valid ? (
							<>
								<InlineNotice tone="negative">{t("config.invalid")}</InlineNotice>
								<ul className={styles.validation}>
									{preview.errors.map((item, index) => (
										<li key={`${item.path}-${index}`}>
											<code>{item.path}</code>
											<span>{item.message}</span>
										</li>
									))}
								</ul>
							</>
						) : null}
						{preview?.valid && !preview.changed ? (
							<EmptyState
								description={t("config.noChangesBody")}
								icon="check"
								title={t("config.noChanges")}
							/>
						) : null}
						{preview?.valid && preview.changed && previewSource ? (
							<>
								<InlineNotice tone="positive">
									{t("config.valid", { revision: preview.revision?.slice(0, 12) })}
								</InlineNotice>
								<div className={styles.diffLabels}>
									<span>{t("config.before")}</span>
									<span>{t("config.after")}</span>
								</div>
								<SourceDiff modified={previewSource} original={original} />
								<ol className={styles.fieldDiff}>
									{preview.changes.map((change, index) => (
										<li key={`${change.path}-${index}`}>
											<code>{change.path}</code>
											<div>
												<span className={styles.before}>{change.before ?? t("config.emptyValue")}</span>
												<span className={styles.after}>{change.after ?? t("config.emptyValue")}</span>
											</div>
										</li>
									))}
								</ol>
							</>
						) : null}
					</Card>
				</div>
			) : null}

			<ConfirmDialog
				busy={busy}
				confirmLabel={confirm === "apply" ? t("config.applyConfirm") : t("config.restoreConfirm")}
				danger={confirm === "restore"}
				description={confirm === "apply" ? t("config.applyBody") : t("config.restoreBody")}
				onCancel={() => setConfirm(null)}
				onConfirm={() => void (confirm === "apply" ? apply() : restore())}
				open={confirm !== null}
				title={confirm === "apply" ? t("config.applyTitle") : t("config.restoreTitle")}
			/>
		</>
	);
}
