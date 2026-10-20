"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

const labels: Record<Locale, { key: "switchToArabic" | "switchToFrench"; lang: Locale }> = {
  ar: { key: "switchToArabic", lang: "ar" },
  fr: { key: "switchToFrench", lang: "fr" },
};

export function LocaleSwitcher() {
  const t = useTranslations("Header");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className="flex items-center gap-1">
      {(Object.keys(labels) as Locale[]).map((locale) => {
        const { key, lang } = labels[locale];
        const active = current === locale;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            lang={lang}
            hrefLang={lang}
            aria-current={active ? "true" : undefined}
            className={cn(buttonVariants({ variant: active ? "default" : "ghost", size: "sm" }))}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
