import { notFound } from "next/navigation";
import { redirect } from "./navigation";
import { isLocale, type Locale } from "./routing";

/** Narrows the `[locale]` route param, rendering the localized 404 for anything unsupported. */
export function resolveLocale(value: string): Locale {
  if (!isLocale(value)) notFound();
  return value;
}

/** Locale-aware redirect typed as `never`, so callers keep TypeScript's null narrowing. */
export function redirectTo(href: string, locale: Locale): never {
  redirect({ href, locale });
  throw new Error("unreachable");
}
