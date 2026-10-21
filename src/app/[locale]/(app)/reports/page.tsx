import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { formatLocaleTag } from "@/i18n/routing";
import { LEAD_STATUSES } from "@/modules/crm/lead-status";
import { formatMoney } from "@/modules/quotes/format";
import { RANGE_KEYS, parseRange } from "@/modules/reports/rules";
import { buildReport, type ExportSection } from "@/modules/reports/service";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
};

export default async function ReportsPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requirePagePermission("report:read");
  const range = parseRange((await searchParams).range);

  const [t, tRange, tLead, tProject, tPriority, format] = await Promise.all([
    getTranslations("Reports"),
    getTranslations("Reports.range"),
    getTranslations("Crm.leadStatus"),
    getTranslations("Projects.status"),
    getTranslations("Tickets.priority"),
    getAppFormatter(),
  ]);
  const report = await buildReport(await actionContext(), { range });
  const canExport = can(session.actor.role, "report:export");
  const tag = formatLocaleTag[locale];
  const n = (value: number) => format.number(value);
  const pct = (value: string | null) => (value === null ? t("noData") : `${value}%`);
  const money = (value: string | null) =>
    value === null ? t("hidden") : `${formatMoney(value, tag)} ${t("currency")}`;
  const maxLead = Math.max(1, ...Object.values(report.sales.leadsByStatus));
  const exportHref = (section: ExportSection) =>
    `/api/reports/export?section=${section}&range=${range}&locale=${locale}`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <form method="get" role="search" className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="range" className="text-sm font-medium">
              {t("period")}
            </label>
            <Select id="range" name="range" defaultValue={range}>
              {RANGE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {tRange(key)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">{t("apply")}</Button>
        </form>
      </header>
      <p className="text-xs text-muted-foreground">
        {t("window", {
          from: format.dateTime(report.from, { dateStyle: "medium" }),
          to: format.dateTime(report.to, { dateStyle: "medium" }),
        })}
      </p>

      {/* --- sales ---------------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("sales")}</CardTitle>
          <CardDescription>{t("salesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t("winRate")} value={pct(report.sales.winRatePct)} testId="r-win-rate" />
            <Stat label={t("won")} value={n(report.sales.wonInRange)} />
            <Stat label={t("lost")} value={n(report.sales.lostInRange)} />
            <Stat
              label={t("quotesIssued")}
              value={n(report.sales.quotesIssued)}
              testId="r-quotes-issued"
            />
            <Stat label={t("quotesAccepted")} value={n(report.sales.quotesAccepted)} />
            <Stat label={t("quotesRejected")} value={n(report.sales.quotesRejected)} />
            <Stat label={t("acceptanceRate")} value={pct(report.sales.acceptanceRatePct)} />
            {report.financial ? (
              <>
                <Stat
                  label={t("issuedTotal")}
                  value={money(report.sales.issuedTotalDzd)}
                  testId="r-issued-total"
                />
                <Stat label={t("acceptedTotal")} value={money(report.sales.acceptedTotalDzd)} />
                <Stat
                  label={t("averageAccepted")}
                  value={
                    report.sales.averageAcceptedDzd === null
                      ? t("noData")
                      : money(report.sales.averageAcceptedDzd)
                  }
                />
              </>
            ) : null}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("funnel")}</h3>
            <Table caption={t("funnelTable")}>
              <thead>
                <tr>
                  <Th>{t("stage")}</Th>
                  <Th>{t("count")}</Th>
                  <Th>
                    <span className="sr-only">{t("bar")}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {LEAD_STATUSES.map((status) => (
                  <tr key={status}>
                    <Td>{tLead(status)}</Td>
                    <Td dir="ltr">{n(report.sales.leadsByStatus[status])}</Td>
                    <Td className="w-1/2">
                      <div aria-hidden="true" className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{
                            width: `${(report.sales.leadsByStatus[status] / maxLead) * 100}%`,
                          }}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {canExport ? <ExportLink href={exportHref("quotes")} label={t("exportQuotes")} /> : null}
        </CardContent>
      </Card>

      {/* --- operations ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("operations")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label={t("projectsCompleted")}
              value={n(report.operations.completedInRange)}
              testId="r-projects-completed"
            />
            <Stat
              label={t("averageDuration")}
              value={
                report.operations.averageDurationDays === null
                  ? t("noData")
                  : t("days", { value: report.operations.averageDurationDays })
              }
            />
            <Stat label={t("openTasks")} value={n(report.operations.openTasks)} />
            <Stat
              label={t("overdueTasks")}
              value={n(report.operations.overdueTasks)}
              tone={report.operations.overdueTasks > 0 ? "danger" : undefined}
            />
          </dl>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(
              Object.entries(report.operations.projectsByStatus) as [
                keyof typeof report.operations.projectsByStatus,
                number,
              ][]
            ).map(([status, count]) => (
              <li key={status} className="rounded-md border border-border px-3 py-1">
                {tProject(status)}: <strong>{n(count)}</strong>
              </li>
            ))}
          </ul>
          {canExport ? (
            <ExportLink href={exportHref("projects")} label={t("exportProjects")} />
          ) : null}
        </CardContent>
      </Card>

      {/* --- support -------------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("support")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label={t("ticketsOpened")}
              value={n(report.support.openedInRange)}
              testId="r-tickets-opened"
            />
            <Stat label={t("ticketsResolved")} value={n(report.support.resolvedInRange)} />
            <Stat
              label={t("averageResolution")}
              value={
                report.support.averageResolutionHours === null
                  ? t("noData")
                  : t("hours", { value: report.support.averageResolutionHours })
              }
            />
          </dl>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(["urgent", "high", "normal", "low"] as const).map((priority) => (
              <li key={priority} className="rounded-md border border-border px-3 py-1">
                {t("openPriority", { priority: tPriority(priority) })}:{" "}
                <strong>{n(report.support.openNow[priority])}</strong>
              </li>
            ))}
          </ul>
          {canExport ? (
            <ExportLink href={exportHref("tickets")} label={t("exportTickets")} />
          ) : null}
        </CardContent>
      </Card>

      {/* --- maintenance ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("maintenance")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t("activeContracts")} value={n(report.maintenance.activeContracts)} />
            {report.financial ? (
              <Stat label={t("monthlyFees")} value={money(report.maintenance.monthlyFeesDzd)} />
            ) : null}
            <Stat
              label={t("overdueVisits")}
              value={n(report.maintenance.overdueVisits)}
              tone={report.maintenance.overdueVisits > 0 ? "danger" : undefined}
            />
            <Stat label={t("dueSoonVisits")} value={n(report.maintenance.dueSoonVisits)} />
            <Stat label={t("visitsDone")} value={n(report.maintenance.visitsInRange)} />
          </dl>
          {canExport ? (
            <ExportLink href={exportHref("maintenance")} label={t("exportMaintenance")} />
          ) : null}
        </CardContent>
      </Card>

      {/* --- backups -------------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("backups")}</CardTitle>
          <CardDescription>{t("backupsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label={t("policies")} value={n(report.backups.activePolicies)} />
            <Stat label={t("healthy")} value={n(report.backups.ok)} />
            <Stat label={t("needAttention")} value={n(report.backups.warning)} />
            <Stat
              label={t("critical")}
              value={n(report.backups.critical)}
              tone={report.backups.critical > 0 ? "danger" : undefined}
            />
            <Stat
              label={t("neverRestored")}
              value={n(report.backups.neverTested)}
              tone={report.backups.neverTested > 0 ? "danger" : undefined}
            />
          </dl>
          {canExport ? (
            <ExportLink href={exportHref("backups")} label={t("exportBackups")} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <div>
      {/* A plain link: the browser downloads the file; the server audits the export. */}
      <a href={href} download className={buttonVariants({ variant: "outline", size: "sm" })}>
        {label}
      </a>
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
        className={tone === "danger" ? "text-xl font-bold text-danger" : "text-xl font-bold"}
        dir="auto"
      >
        {value}
      </dd>
    </div>
  );
}
