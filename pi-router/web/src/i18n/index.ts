import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import vi from "./locales/vi.json";

export type Language = "vi" | "en";

export function detectLanguage(): Language {
	const candidates = typeof navigator !== "undefined" && navigator.languages?.length
		? navigator.languages
		: [typeof navigator !== "undefined" ? navigator.language : "en"];
	return candidates.some((language) => language.toLowerCase().startsWith("vi"))
		? "vi"
		: "en";
}

void i18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		vi: { translation: vi },
	},
	lng: detectLanguage(),
	fallbackLng: "en",
	interpolation: {
		escapeValue: false,
	},
	react: {
		useSuspense: false,
	},
});

export default i18n;
