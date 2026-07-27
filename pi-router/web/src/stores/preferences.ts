import { create } from "zustand";

import i18n, { detectLanguage, type Language } from "../i18n";

export type { Language } from "../i18n";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "pi-router.preference.theme";
const LANGUAGE_KEY = "pi-router.preference.language";

function readPreference(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writePreference(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Preferences are optional and never block the console.
	}
}

function storedTheme(): Theme {
	const value = readPreference(THEME_KEY);
	return value === "light" || value === "dark" || value === "system"
		? value
		: "system";
}

function storedLanguage(): Language {
	const value = readPreference(LANGUAGE_KEY);
	return value === "vi" || value === "en" ? value : detectLanguage();
}

function resolvedTheme(theme: Theme): "light" | "dark" {
	if (theme !== "system") {
		return theme;
	}
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = resolvedTheme(theme);
}

interface PreferenceState {
	theme: Theme;
	language: Language;
	initialize: () => () => void;
	setTheme: (theme: Theme) => void;
	setLanguage: (language: Language) => void;
}

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
	theme: storedTheme(),
	language: storedLanguage(),
	initialize: () => {
		applyTheme(get().theme);
		void i18n.changeLanguage(get().language);
		document.documentElement.lang = get().language;
		const media = window.matchMedia?.("(prefers-color-scheme: dark)");
		const listener = () => {
			if (get().theme === "system") {
				applyTheme("system");
			}
		};
		media?.addEventListener("change", listener);
		return () => media?.removeEventListener("change", listener);
	},
	setTheme: (theme) => {
		writePreference(THEME_KEY, theme);
		applyTheme(theme);
		set({ theme });
	},
	setLanguage: (language) => {
		writePreference(LANGUAGE_KEY, language);
		document.documentElement.lang = language;
		void i18n.changeLanguage(language);
		set({ language });
	},
}));
