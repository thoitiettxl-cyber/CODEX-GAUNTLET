import { useEffect, useMemo, useState } from "react";

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
import { Icon } from "../../components/ui/Icon";
import {
	errorMessage,
	type ConfigPreview,
	type ConfigState,
	type ManagementClient,
} from "../../lib/api";

type ConfirmAction = "apply" | "restore" | null;

function asDocument(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Configuration must be a JSON object.");
	}
	return value as Record<string, unknown>;
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
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [config, setConfig] = useState<ConfigState | null>(null);
	const [draft, setDraft] = useState("");
	const [preview, setPreview] = useState<ConfigPreview | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmAction>(null);
	const original = useMemo(
		() => config?.document ? `${JSON.stringify(config.document, null, 2)}\n` : "",
		[config],
	);
	const dirty = Boolean(config?.editable && draft !== original);

	const load = async () => {
		setPhase("loading");
		setError("");
		try {
			const next = await client.getConfig();
			setConfig(next);
			setDraft(next.document ? `${JSON.stringify(next.document, null, 2)}\n` : "");
			setPreview(null);
			setPhase("ready");
		} catch (caught) {
			setError(errorMessage(caught));
			setPhase("error");
		}
	};

	useEffect(() => {
		void load();
	}, []);

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
		setPreview(null);
		setError("");
	};

	const parse = () => {
		try {
			return asDocument(JSON.parse(draft));
		} catch (caught) {
			throw new Error(caught instanceof SyntaxError
				? `JSON syntax error: ${caught.message}`
				: errorMessage(caught));
		}
	};

	const runPreview = async () => {
		setBusy(true);
		setError("");
		try {
			setPreview(await client.previewConfig(parse()));
		} catch (caught) {
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
			notify(
				result.restart_required
					? "Configuration applied. Restart Pi Router to activate every change."
					: "Configuration applied and reloaded.",
			);
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
			notify(
				result.restart_required
					? "Recovery configuration restored; restart is required."
					: "Recovery configuration restored and reloaded.",
			);
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
				actions={<Button icon="refresh" onClick={() => void load()}>Reload configuration</Button>}
				description="Edit the reviewed non-secret models.json surface with validation, stale-write protection, and atomic recovery."
				eyebrow="Control"
				title="Config Panel"
			/>
			<InlineNotice>
				<strong>Allowlisted editor.</strong> Secret-bearing <code>apiKey</code>, sensitive
				headers, arbitrary paths, environment state, credential files, and executables are rejected.
			</InlineNotice>

			{phase === "loading" ? <Card><LoadingState label="Loading safe configuration…" /></Card> : null}
			{phase === "error" ? (
				<Card><ErrorState message={error} onRetry={() => void load()} /></Card>
			) : null}
			{phase === "ready" && config && !config.supported ? (
				<Card>
					<EmptyState
						description="The server was not started with a router-owned models.json target, so browser configuration is disabled."
						icon="config"
						title="Configuration editing unsupported"
					/>
				</Card>
			) : null}
			{phase === "ready" && config?.supported && !config.editable ? (
				<Card>
					<ErrorState
						message="The current file is invalid or contains fields outside the non-secret Management API allowlist. Edit it through the local CLI before using this panel."
						onRetry={() => void load()}
					/>
					{config.errors.length ? (
						<ul className="validation-list">
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
				<div className="config-layout">
					<Card className="editor-card">
						<SectionHeader
							actions={
								<div className="button-row">
									{dirty ? <Badge tone="warning">Unsaved draft</Badge> : <Badge tone="positive">In sync</Badge>}
									<Button
										disabled={!dirty || busy}
										onClick={() => setDraft(original)}
										size="compact"
									>
										Reset draft
									</Button>
								</div>
							}
							description="JSON draft remains in page memory until a validated apply."
							title="models.json"
						/>
						<label className="config-editor">
							<span className="visually-hidden">Router models configuration JSON</span>
							<textarea
								aria-describedby="config-editor-help"
								name="models_config"
								onChange={(event) => changeDraft(event.target.value)}
								spellCheck={false}
								value={draft}
							/>
						</label>
						<div className="editor-footer" id="config-editor-help">
							<span>Revision <code>{config.revision?.slice(0, 12)}…</code></span>
							<span>{new Blob([draft]).size.toLocaleString()} bytes in page memory</span>
						</div>
						{error ? <InlineNotice tone="negative">{error}</InlineNotice> : null}
						<div className="editor-actions">
							{config.recovery_available ? (
								<Button
									disabled={busy}
									onClick={() => setConfirm("restore")}
									variant="danger"
								>
									Restore previous
								</Button>
							) : <span className="muted">No validated recovery input yet</span>}
							<div className="button-row">
								<Button
									disabled={!dirty || busy}
									icon="shield"
									onClick={() => void runPreview()}
								>
									{busy ? "Validating…" : "Validate & preview"}
								</Button>
								<Button
									disabled={!preview?.valid || !preview.changed || busy}
									onClick={() => setConfirm("apply")}
									variant="primary"
								>
									Apply changes
								</Button>
							</div>
						</div>
					</Card>

					<Card className="diff-card">
						<SectionHeader
							description="A fresh preview is required after every draft edit."
							title="Validation & diff"
						/>
						{!preview ? (
							<EmptyState
								description="Edit the document, then validate to see the exact bounded field changes."
								icon="shield"
								title="No current preview"
							/>
						) : null}
						{preview && !preview.valid ? (
							<>
								<InlineNotice tone="negative">
									The draft was not accepted. No file was written.
								</InlineNotice>
								<ul className="validation-list">
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
								description="The validated draft is identical to the current configuration."
								icon="check"
								title="No changes detected"
							/>
						) : null}
						{preview?.valid && preview.changed ? (
							<>
								<InlineNotice tone="positive">
									Validation passed. Apply will compare revision <code>{preview.revision?.slice(0, 12)}…</code>.
								</InlineNotice>
								<ol className="diff-list">
									{preview.changes.map((change, index) => (
										<li key={`${change.path}-${index}`}>
											<code>{change.path}</code>
											<div>
												<span className="diff-before">{change.before ?? "not present"}</span>
												<Icon name="arrow" />
												<span className="diff-after">{change.after ?? "removed"}</span>
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
				confirmLabel={confirm === "apply" ? "Apply atomically" : "Restore validated config"}
				danger={confirm === "restore"}
				description={
					confirm === "apply"
						? "Write this validated draft with revision compare-and-set and retain the current valid document for recovery?"
						: "Replace the current document with the retained validated predecessor? The current valid document becomes the next recovery input."
				}
				onCancel={() => setConfirm(null)}
				onConfirm={() => void (confirm === "apply" ? apply() : restore())}
				open={confirm !== null}
				title={confirm === "apply" ? "Apply configuration?" : "Restore previous configuration?"}
			/>
		</>
	);
}
