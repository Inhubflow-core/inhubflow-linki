export type Locale = "en" | "es" | "pt-BR";

export interface LocaleOption {
  code: Locale;
  label: string;
  flag: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "pt-BR", label: "Português (BR)", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
];

export type TranslationParams = Record<string, string | number>;
