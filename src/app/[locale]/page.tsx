import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkDatabase, type DatabaseStatus } from "@/server/health/checks";

// Status comes from live checks, so this page must never be statically cached.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

const statusIcon = {
  ok: <CheckCircle2 aria-hidden="true" className="size-4 text-success" />,
  unavailable: <CircleAlert aria-hidden="true" className="size-4 text-danger" />,
  not_configured: <CircleDashed aria-hidden="true" className="size-4 text-muted-foreground" />,
} satisfies Record<DatabaseStatus, React.ReactNode>;

const statusKey = {
  ok: "ok",
  unavailable: "unavailable",
  not_configured: "notConfigured",
} as const satisfies Record<DatabaseStatus, string>;

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const [t, tc] = await Promise.all([getTranslations("Home"), getTranslations("Common")]);
  const database = await checkDatabase();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="text-sm font-medium text-primary">{tc("tagline")}</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("subtitle")}</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
          <CardDescription>{t("statusDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3" data-testid="status-list">
            <li className="flex items-center justify-between gap-4">
              <span>{t("application")}</span>
              <span className="flex items-center gap-2" data-testid="status-app">
                {statusIcon.ok}
                {t("ok")}
              </span>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span>{t("database")}</span>
              <span className="flex items-center gap-2" data-testid="status-database">
                {statusIcon[database]}
                {t(statusKey[database])}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t("foundationNote")}</p>
    </div>
  );
}
