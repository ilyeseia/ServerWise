import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { isLocale, localeDirection, locales } from "@/i18n/routing";
import { accessGate } from "@/server/auth/session";
import { getCurrentSession } from "@/server/auth/current";
import { isOwner2faRequired } from "@/server/config/env";
import "../globals.css";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Common" });
  // The per-request nonce set by the proxy; the theme script below is inline and needs it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const session = await getCurrentSession();
  const gated = session
    ? accessGate(session, { require2faForOwner: isOwner2faRequired() }) !== "ok"
    : false;

  return (
    <html lang={locale} dir={localeDirection[locale]} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          <ThemeProvider nonce={nonce}>
            <a
              href="#main"
              className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
            >
              {t("skipToContent")}
            </a>
            <SiteHeader
              user={session ? { name: session.actor.name, role: session.actor.role } : null}
              gated={gated}
            />
            <main id="main" className="mx-auto max-w-5xl px-4 py-10">
              {children}
            </main>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
