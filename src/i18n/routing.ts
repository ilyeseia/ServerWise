import { defineRouting } from "next-intl/routing";

export const locales = ["ar", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";

export const localeDirection: Record<Locale, "rtl" | "ltr"> = {
  ar: "rtl",
  fr: "ltr",
};

/**
 * Locale tags used for numbers and dates. Plain "ar" makes ICU print Arabic-Indic digits
 * (٠١٢٣), but Algeria writes Western digits (0123) even in Arabic text, so formatting uses the
 * Algerian regional variants. Message translation still uses the plain "ar" / "fr" locale.
 */
export const formatLocaleTag: Record<Locale, string> = {
  ar: "ar-DZ",
  fr: "fr-DZ",
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
