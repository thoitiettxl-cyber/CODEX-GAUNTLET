import { useState, type FormEvent } from "react";

import { Button, InlineNotice } from "../components/ui";
import { Icon } from "../components/ui/Icon";

export function ConnectionGate({
	value,
	phase,
	error,
	onChange,
	onConnect,
}: {
	value: string;
	phase: "idle" | "checking" | "error";
	error: string;
	onChange: (value: string) => void;
	onConnect: () => void;
}) {
	const [visible, setVisible] = useState(false);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onConnect();
	};
	return (
		<div className="connection-gate">
			<section className="gate-card" aria-labelledby="connect-title">
				<div className="gate-mark"><Icon name="shield" /></div>
				<p className="page-eyebrow">Loopback authentication</p>
				<h1 id="connect-title">Connect to Pi Router</h1>
				<p className="gate-intro">
					Enter the management bearer configured in{" "}
					<code>PI_ROUTER_MANAGEMENT_KEY</code>. It stays only in memory for this page
					and is cleared when you reload or disconnect.
				</p>
				<form onSubmit={submit}>
					<label className="field">
						<span>Management bearer</span>
						<div className="secret-input">
							<Icon name="key" />
							<input
								autoComplete="off"
								autoFocus
								name="router-bearer"
								onChange={(event) => onChange(event.target.value)}
								placeholder="Enter the management bearer"
								spellCheck={false}
								type={visible ? "text" : "password"}
								value={value}
							/>
							<button
								aria-label={visible ? "Hide bearer token" : "Show bearer token"}
								onClick={() => setVisible((current) => !current)}
								type="button"
							>
								{visible ? "Hide" : "Show"}
							</button>
						</div>
					</label>
					<Button
						className="gate-submit"
						disabled={phase === "checking" || value.trim().length === 0}
						variant="primary"
						type="submit"
					>
						{phase === "checking" ? "Checking connection…" : "Open operations console"}
					</Button>
				</form>
				{phase === "error" ? (
					<InlineNotice tone="negative">{error}</InlineNotice>
				) : (
					<InlineNotice>
						The static page loads without touching provider state. Authentication begins
						only when you submit this form. Inference clients use separately managed
						proxy API keys.
					</InlineNotice>
				)}
			</section>
			<aside className="gate-aside" aria-label="Security boundary">
				<div>
					<span className="gate-step">01</span>
					<strong>Loopback only</strong>
					<p>The service accepts only 127.0.0.1 or ::1 listeners.</p>
				</div>
				<div>
					<span className="gate-step">02</span>
					<strong>Memory only</strong>
					<p>No cookie, browser storage, telemetry, or remote asset is used.</p>
				</div>
				<div>
					<span className="gate-step">03</span>
					<strong>Metadata bounded</strong>
					<p>
						Credential values, inference prompts, submitted auth responses, bodies, and
						raw paths never enter console results.
					</p>
				</div>
			</aside>
		</div>
	);
}
