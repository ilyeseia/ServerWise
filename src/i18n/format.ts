import { getFormatter, getLocale } from "next-intl/server";
import { formatLocaleTag, isLocale, type Locale } from "./routing";

/** Server-side formatter (numbers, dates) with Algerian conventions for the request locale. */
export async function getAppFormatter() {
  const locale = await getLocale();
  const tag = formatLocaleTag[isLocale(locale) ? locale : "ar"];
  // next-intl types `locale` as our two message locales, but at runtime it is any BCP 47 tag
  // handed to Intl; the regional tag only changes number/date conventions.
  return getFormatter({ locale: tag as unknown as Locale });
}
