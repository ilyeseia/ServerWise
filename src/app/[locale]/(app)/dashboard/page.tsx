import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveLocale } from "@/i18n/locale";
import { getBackupStats } from "@/modules/backups/service";
import { getCareStats } from "@/modules/careops/stats";
import { LEAD_STATUSES } from "@/modules/crm/lead-status";
import { getCrmStats } from "@/modules/crm/stats";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
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

  const [t, tr, tStatus, format] = await Promise.all([
    getTranslations("Dashboard"),
    getTranslations("Roles"),
    getTranslations("Crm.leadStatus"),
    getAppFormatter(),
  ]);
  const database = await checkDatabase();
  const crm = can(session.actor.role, "crm:read") ? await getCrmStats(await actionContext()) : null;
  const care = await getCareStats(await actionContext());
  const backups = can(session.actor.role, "backup:read")
    ? await getBackupStats(await actionContext())
    : null;
  const showCare = care.tickets !== null || care.maintenance !== null || care.assets !== null;
  const crmIsEmpty =
    crm !== null &&
    crm.customers.prospect + crm.customers.active === 0 &&
    Object.values(crm.leadsByStatus).every((n) => n === 0) &&
    crm.openFollowUps === 0;

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

      {crm ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("crmTitle")}</CardTitle>
            <CardDescription>{t("crmDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {crmIsEmpty ? <p className="text-sm text-muted-foreground">{t("crmEmpty")}</p> : null}
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="crm-stats">
              <Stat
                label={t("prospects")}
                value={format.number(crm.customers.prospect)}
                testId="stat-prospects"
              />
              <Stat
                label={t("activeCustomers")}
                value={format.number(crm.customers.active)}
                testId="stat-active"
              />
              <Stat label={t("newCustomers30")} value={format.number(crm.newCustomersLast30Days)} />
              <Stat label={t("openFollowUps")} value={format.number(crm.openFollowUps)} />
              <Stat
                label={t("overdueFollowUps")}
                value={format.number(crm.overdueFollowUps)}
                tone={crm.overdueFollowUps > 0 ? "danger" : undefined}
                testId="stat-overdue"
              />
              <Stat
                label={t("myOverdue")}
                value={format.number(crm.myOverdueFollowUps)}
                tone={crm.myOverdueFollowUps > 0 ? "danger" : undefined}
              />
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("leadsByStage")}</h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {LEAD_STATUSES.map((s) => (
                  <li
                    key={s}
                    className="rounded-md border border-border px-3 py-1"
                    data-testid={`stage-${s}`}
                  >
                    {tStatus(s)}: <strong>{format.number(crm.leadsByStatus[s])}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showCare ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("careTitle")}</CardTitle>
            <CardDescription>{t("careDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="care-stats">
              {care.tickets ? (
                <>
                  <Stat
                    label={t("openTickets")}
                    value={format.number(care.tickets.open)}
                    testId="stat-open-tickets"
                  />
                  <Stat
                    label={t("urgentTickets")}
                    value={format.number(care.tickets.urgent)}
                    tone={care.tickets.urgent > 0 ? "danger" : undefined}
                    testId="stat-urgent-tickets"
                  />
                </>
              ) : null}
              {care.maintenance ? (
                <>
                  <Stat
                    label={t("overdueMaintenance")}
                    value={format.number(care.maintenance.overdue)}
                    tone={care.maintenance.overdue > 0 ? "danger" : undefined}
                    testId="stat-overdue-maintenance"
                  />
                  <Stat
                    label={t("dueSoonMaintenance")}
                    value={format.number(care.maintenance.dueSoon)}
                    testId="stat-due-soon-maintenance"
                  />
                </>
              ) : null}
              {care.assets ? (
                <Stat
                  label={t("warrantyExpiring")}
                  value={format.number(care.assets.warrantyExpiring)}
                  testId="stat-warranty-expiring"
                />
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {backups ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("backupsTitle")}</CardTitle>
            <CardDescription>{t("backupsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {backups.policies === 0 ? (
              <p className="text-sm text-muted-foreground">{t("backupsEmpty")}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="backup-stats">
                <Stat
                  label={t("backupPolicies")}
                  value={format.number(backups.policies)}
                  testId="stat-backup-policies"
                />
                <Stat
                  label={t("backupsCritical")}
                  value={format.number(backups.critical)}
                  tone={backups.critical > 0 ? "danger" : undefined}
                  testId="stat-backup-critical"
                />
                <Stat
                  label={t("backupsWarning")}
                  value={format.number(backups.warning)}
                  testId="stat-backup-warning"
                />
                <Stat
                  label={t("backupsNeverTested")}
                  value={format.number(backups.neverTested)}
                  tone={backups.neverTested > 0 ? "danger" : undefined}
                  testId="stat-backup-never-tested"
                />
              </dl>
            )}
          </CardContent>
        </Card>
      ) : null}

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

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "danger";
  testId?: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        data-testid={testId}
        className={tone === "danger" ? "text-2xl font-bold text-danger" : "text-2xl font-bold"}
      >
        {value}
      </dd>
    </div>
  );
}
