import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import frTranslations from "./i18n/locales/fr.json";
import enTranslations from "./i18n/locales/en.json";
import arTranslations from "./i18n/locales/ar.json";

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            fr: { translation: frTranslations },
            en: { translation: enTranslations },
            ar: { translation: arTranslations },
        },
        fallbackLng: "fr",
        interpolation: {
            escapeValue: false,
        },
        detection: {
            order: ["localStorage", "navigator"],
            caches: ["localStorage"],
        },
    });

export default i18n;
