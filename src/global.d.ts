import type { locales } from "@/i18n/routing";
import type messages from "../messages/ar.json";

// Typed locales and message keys: a missing/misspelled translation key fails typecheck.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: typeof messages;
  }
}
