import {
	type ButtonHTMLAttributes,
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useRef,
} from "react";

import { Icon } from "./Icon";

export function Button({
	children,
	variant = "secondary",
	size = "default",
	icon,
	className = "",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "default" | "compact";
	icon?: Parameters<typeof Icon>[0]["name"];
}) {
	return (
		<button
			className={`button button-${variant} button-${size} ${className}`.trim()}
			type="button"
			{...props}
		>
			{icon ? <Icon name={icon} /> : null}
			<span>{children}</span>
		</button>
	);
}

export function IconButton({
	label,
	icon,
	className = "",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	icon: Parameters<typeof Icon>[0]["name"];
}) {
	return (
		<button
			aria-label={label}
			className={`icon-button ${className}`.trim()}
			title={label}
			type="button"
			{...props}
		>
			<Icon name={icon} />
		</button>
	);
}

export function Card({
	children,
	className = "",
	...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
	return (
		<section className={`card ${className}`.trim()} {...props}>
			{children}
		</section>
	);
}

export function PageHeader({
	eyebrow,
	title,
	description,
	actions,
}: {
	eyebrow: string;
	title: string;
	description: string;
	actions?: ReactNode;
}) {
	return (
		<header className="page-header">
			<div>
				<p className="page-eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				<p className="page-description">{description}</p>
			</div>
			{actions ? <div className="page-actions">{actions}</div> : null}
		</header>
	);
}

export function SectionHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
}) {
	return (
		<div className="section-header">
			<div>
				<h2>{title}</h2>
				{description ? <p>{description}</p> : null}
			</div>
			{actions ? <div className="section-actions">{actions}</div> : null}
		</div>
	);
}

export function Badge({
	children,
	tone = "neutral",
}: {
	children: ReactNode;
	tone?: "positive" | "warning" | "negative" | "neutral" | "info";
}) {
	return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatCard({
	label,
	value,
	detail,
	icon,
	tone = "default",
}: {
	label: string;
	value: ReactNode;
	detail: ReactNode;
	icon: Parameters<typeof Icon>[0]["name"];
	tone?: "default" | "positive" | "warning";
}) {
	return (
		<Card className={`stat-card stat-${tone}`}>
			<div className="stat-icon"><Icon name={icon} /></div>
			<div>
				<p>{label}</p>
				<strong>{value}</strong>
				<span>{detail}</span>
			</div>
		</Card>
	);
}

export function LoadingState({ label = "Loading current state…" }: { label?: string }) {
	return (
		<div className="state-panel" aria-live="polite" aria-busy="true">
			<span className="spinner" aria-hidden="true" />
			<div>
				<strong>{label}</strong>
				<p>Reading the authenticated loopback service.</p>
			</div>
		</div>
	);
}

export function ErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="state-panel state-error" role="alert">
			<div className="state-icon"><Icon name="warning" /></div>
			<div>
				<strong>Unable to load this view</strong>
				<p>{message}</p>
				{onRetry ? <Button size="compact" onClick={onRetry} icon="refresh">Try again</Button> : null}
			</div>
		</div>
	);
}

export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: Parameters<typeof Icon>[0]["name"];
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="empty-state">
			<div className="empty-icon"><Icon name={icon} /></div>
			<h3>{title}</h3>
			<p>{description}</p>
			{action ? <div>{action}</div> : null}
		</div>
	);
}

export function InlineNotice({
	children,
	tone = "info",
}: {
	children: ReactNode;
	tone?: "info" | "positive" | "warning" | "negative";
}) {
	return (
		<div className={`inline-notice notice-${tone}`} role={tone === "negative" ? "alert" : "status"}>
			<Icon name={tone === "positive" ? "check" : tone === "info" ? "shield" : "warning"} />
			<div>{children}</div>
		</div>
	);
}

export function SearchField({
	value,
	onChange,
	placeholder,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	label: string;
}) {
	return (
		<label className="search-field">
			<span className="visually-hidden">{label}</span>
			<Icon name="search" />
			<input
				name="filter"
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				type="search"
				value={value}
			/>
		</label>
	);
}

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	danger = false,
	busy = false,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	danger?: boolean;
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) {
			return;
		}
		const previous = document.activeElement as HTMLElement | null;
		const first = dialogRef.current?.querySelector<HTMLElement>("button");
		first?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !busy) {
				event.preventDefault();
				onCancel();
			}
			if (event.key === "Tab" && dialogRef.current) {
				const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
				if (focusable.length === 0) {
					return;
				}
				const index = focusable.indexOf(document.activeElement as HTMLElement);
				const next = event.shiftKey
					? (index <= 0 ? focusable.length - 1 : index - 1)
					: (index >= focusable.length - 1 ? 0 : index + 1);
				event.preventDefault();
				focusable[next]?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			previous?.focus();
		};
	}, [busy, onCancel, open]);
	if (!open) {
		return null;
	}
	return (
		<div className="dialog-backdrop" role="presentation" onMouseDown={() => !busy && onCancel()}>
			<div
				aria-describedby="confirm-description"
				aria-labelledby="confirm-title"
				aria-modal="true"
				className="dialog"
				onMouseDown={(event) => event.stopPropagation()}
				ref={dialogRef}
				role="dialog"
			>
				<div className={`dialog-symbol ${danger ? "danger" : ""}`}>
					<Icon name={danger ? "warning" : "shield"} />
				</div>
				<h2 id="confirm-title">{title}</h2>
				<p id="confirm-description">{description}</p>
				<div className="dialog-actions">
					<Button disabled={busy} onClick={onCancel}>Cancel</Button>
					<Button
						disabled={busy}
						onClick={onConfirm}
						variant={danger ? "danger" : "primary"}
					>
						{busy ? "Working…" : confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
