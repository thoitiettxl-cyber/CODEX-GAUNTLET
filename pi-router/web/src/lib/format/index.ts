import i18n from "../../i18n";

function numberFormatter(): Intl.NumberFormat {
	return new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
		maximumFractionDigits: 1,
	});
}

function dateFormatter(): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function formatNumber(value: number): string {
	return numberFormatter().format(value);
}

export function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) {
		return `${Math.round(milliseconds)} ms`;
	}
	return `${numberFormatter().format(milliseconds / 1000)} s`;
}

export function formatUptime(seconds: number): string {
	if (seconds < 60) {
		return `${Math.max(0, Math.floor(seconds))}s`;
	}
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

export function formatDate(value: string | null | undefined): string {
	if (!value) {
		return "—";
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? dateFormatter().format(timestamp) : "—";
}

export function formatBytes(value: number): string {
	if (value < 1024) {
		return `${value} B`;
	}
	if (value < 1024 * 1024) {
		return `${numberFormatter().format(value / 1024)} KB`;
	}
	return `${numberFormatter().format(value / (1024 * 1024))} MB`;
}
