import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button, InlineNotice } from "../components/ui";
import { Icon } from "../components/ui/Icon";
import {
	usePreferenceStore,
	type Language,
	type Theme,
} from "../stores/preferences";
import styles from "./ConnectionGate.module.scss";

export function ConnectionGate({
	value,
	remember,
	phase,
	error,
	onChange,
	onRememberChange,
	onConnect,
}: {
	value: string;
	remember: boolean;
	phase: "idle" | "checking" | "error";
	error: string;
	onChange: (value: string) => void;
	onRememberChange: (value: boolean) => void;
	onConnect: () => void;
}) {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(false);
	const theme = usePreferenceStore((state) => state.theme);
	const language = usePreferenceStore((state) => state.language);
	const setTheme = usePreferenceStore((state) => state.setTheme);
	const setLanguage = usePreferenceStore((state) => state.setLanguage);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onConnect();
	};

	return (
		<div className="connection-gate">
			<div className={styles.toolbar}>
				<label className={styles.preference}>
					<Icon name="config" />
					<span className="visually-hidden">{t("app.theme")}</span>
					<select
						aria-label={t("app.theme")}
						onChange={(event) => setTheme(event.target.value as Theme)}
						value={theme}
					>
						<option value="system">{t("app.themeSystem")}</option>
						<option value="light">{t("app.themeLight")}</option>
						<option value="dark">{t("app.themeDark")}</option>
					</select>
				</label>
				<label className={styles.preference}>
					<Icon name="logs" />
					<span className="visually-hidden">{t("app.language")}</span>
					<select
						aria-label={t("app.language")}
						onChange={(event) => setLanguage(event.target.value as Language)}
						value={language}
					>
						<option value="vi">{t("app.languageVietnamese")}</option>
						<option value="en">{t("app.languageEnglish")}</option>
					</select>
				</label>
			</div>
			<section className="gate-card" aria-labelledby="connect-title">
				<div className="gate-mark"><Icon name="shield" /></div>
				<p className="page-eyebrow">{t("login.eyebrow")}</p>
				<h1 id="connect-title">{t("login.title")}</h1>
				<p className="gate-intro">
					{t("login.intro")}
				</p>
				<form onSubmit={submit}>
					<label className="field">
						<span>{t("login.label")}</span>
						<div className="secret-input">
							<Icon name="key" />
							<input
								autoComplete="off"
								autoFocus
								name="router-bearer"
								onChange={(event) => onChange(event.target.value)}
								placeholder={t("login.placeholder")}
								spellCheck={false}
								type={visible ? "text" : "password"}
								value={value}
							/>
							<button
								aria-label={visible ? t("common.hide") : t("common.show")}
								onClick={() => setVisible((current) => !current)}
								type="button"
							>
								{visible ? t("common.hide") : t("common.show")}
							</button>
						</div>
					</label>
					<label className={styles.remember}>
						<input
							checked={remember}
							name="remember_management_bearer"
							onChange={(event) => onRememberChange(event.target.checked)}
							type="checkbox"
						/>
						<strong>{t("login.remember")}</strong>
						<small>{t("login.rememberHelp")}</small>
					</label>
					<Button
						className="gate-submit"
						disabled={phase === "checking" || value.trim().length === 0}
						variant="primary"
						type="submit"
					>
						{phase === "checking" ? t("login.checking") : t("login.connect")}
					</Button>
				</form>
				{phase === "error" ? (
					<InlineNotice tone="negative">{error}</InlineNotice>
				) : (
					<InlineNotice>{t("login.notice")}</InlineNotice>
				)}
			</section>
			<aside className="gate-aside" aria-label={t("login.safeTitle")}>
				<div>
					<span className="gate-step">01</span>
					<strong>{t("login.loopbackTitle")}</strong>
					<p>{t("login.loopbackBody")}</p>
				</div>
				<div>
					<span className="gate-step">02</span>
					<strong>{t("login.storageTitle")}</strong>
					<p>{t("login.storageBody")}</p>
				</div>
				<div>
					<span className="gate-step">03</span>
					<strong>{t("login.metadataTitle")}</strong>
					<p>{t("login.metadataBody")}</p>
				</div>
			</aside>
		</div>
	);
}
