import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveLocale } from "@/i18n/locale";
import { requirePagePermission } from "@/server/auth/page-guard";
import { checkDatabase, type DatabaseStatus } from "@/server/health/checks";

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

export default async function DashboardPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const session = await requirePagePermission("dashboard:view");

  const [t, tr] = await Promise.all([getTranslations("Dashboard"), getTranslations("Roles")]);
  const database = await checkDatabase();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {t("title", { name: session.actor.name })}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("subtitle")}</p>
        <p className="text-sm font-medium text-primary">
          {t("roleLabel", { role: tr(session.actor.role) })}
        </p>
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
