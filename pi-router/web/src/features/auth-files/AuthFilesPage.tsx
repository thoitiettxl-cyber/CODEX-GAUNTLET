import { useEffect, useState } from "react";

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
	type CredentialInfo,
	type ManagementClient,
} from "../../lib/api";

export function AuthFilesPage({
	client,
	onMutation,
	notify,
}: {
	client: ManagementClient;
	onMutation: () => Promise<void>;
	notify: (message: string, tone?: "positive" | "negative") => void;
}) {
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<CredentialInfo | null>(null);
	const [removing, setRemoving] = useState(false);

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
	}, []);

	const remove = async () => {
		if (!selected) {
			return;
		}
		setRemoving(true);
		try {
			await client.removeCredential(selected.provider_id);
			notify(`Authentication metadata removed for ${selected.provider_name}.`);
			setSelected(null);
			await Promise.all([load(), onMutation()]);
		} catch (caught) {
			notify(errorMessage(caught), "negative");
			setSelected(null);
		} finally {
			setRemoving(false);
		}
	};

	return (
		<>
			<PageHeader
				actions={<Button icon="refresh" onClick={() => void load()}>Refresh metadata</Button>}
				description="Stored authentication is represented by provider and type only. Credential values and file paths never cross this API."
				eyebrow="Gateway"
				title="Auth Files"
			/>
			<InlineNotice>
				<strong>Metadata-only boundary.</strong> This page cannot reveal, download, copy, or
				import API keys, OAuth tokens, credential JSON, or the underlying auth file path.
			</InlineNotice>
			<Card>
				<SectionHeader
					actions={<a className="button button-primary button-default" href="#oauth"><Icon name="login" /><span>Add authentication</span></a>}
					description="One provider-keyed credential can be stored for the selected account."
					title="Stored credentials"
				/>
				{phase === "loading" ? <LoadingState label="Loading credential metadata…" /> : null}
				{phase === "error" ? <ErrorState message={error} onRetry={() => void load()} /> : null}
				{phase === "ready" && credentials.length === 0 ? (
					<EmptyState
						action={<a className="text-link" href="#oauth">Start provider login <Icon name="arrow" /></a>}
						description="Authenticate a provider to make its models available to the local gateway."
						icon="key"
						title="No stored credentials"
					/>
				) : null}
				{phase === "ready" && credentials.length > 0 ? (
					<div className="credential-grid">
						{credentials.map((credential) => (
							<article className="credential-card" key={credential.provider_id}>
								<div className="credential-icon"><Icon name="key" /></div>
								<div className="credential-main">
									<div>
										<h3>{credential.provider_name}</h3>
										<code>{credential.provider_id}</code>
									</div>
									<Badge tone={credential.type === "oauth" ? "info" : "neutral"}>
										{credential.type === "oauth" ? "OAuth credential" : "API key credential"}
									</Badge>
									<p>
										<Icon name="shield" />
										Value hidden by the management boundary
									</p>
								</div>
								<Button
									aria-label={`Log out ${credential.provider_name}`}
									onClick={() => setSelected(credential)}
									variant="danger"
								>
									Log out
								</Button>
							</article>
						))}
					</div>
				) : null}
			</Card>
			<ConfirmDialog
				busy={removing}
				confirmLabel="Remove authentication"
				danger
				description={`Remove the stored ${selected?.type === "oauth" ? "OAuth" : "API key"} credential for ${selected?.provider_name ?? "this provider"}? This does not affect any other provider.`}
				onCancel={() => setSelected(null)}
				onConfirm={() => void remove()}
				open={selected !== null}
				title="Log out this provider?"
			/>
		</>
	);
}
