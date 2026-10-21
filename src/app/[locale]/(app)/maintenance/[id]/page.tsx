import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContractStateBadge, ScheduleStateBadge } from "@/components/care/badges";
import { AddSchedule, CancelContract, ScheduleActions } from "@/components/care/contract-controls";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatLocaleTag } from "@/i18n/routing";
import { getContract, listMaintenanceStaff } from "@/modules/careops/maintenance";
import { formatMoney } from "@/modules/quotes/format";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function ContractPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const session = await requirePagePermission("maintenance:read");
  const ctx = await actionContext();
  const role = session.actor.role;

  const [contract, staff, t, format] = await Promise.all([
    orNotFound(getContract(ctx, id)),
    listMaintenanceStaff(ctx),
    getTranslations("Maintenance"),
    getAppFormatter(),
  ]);
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const canManage = can(role, "maintenance:write");
  const live = contract.state !== "cancelled";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/maintenance" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{contract.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ContractStateBadge state={contract.state} />
            <Link href={`/customers/${contract.customer.id}`} className="hover:underline">
              {contract.customer.name}
            </Link>
            <span className="text-muted-foreground">
              {day(contract.startsAt)} → {day(contract.endsAt)}
            </span>
            {contract.monthlyFeeDzd ? (
              <span dir="ltr">
                {formatMoney(contract.monthlyFeeDzd, formatLocaleTag[locale])} {t("currency")}
              </span>
            ) : null}
          </div>
        </div>
        {canManage && live ? (
          <Link
            href={`/maintenance/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("edit")}
          </Link>
        ) : null}
      </header>

      {contract.state === "cancelled" ? (
        <Alert>
          {t("cancelledOn", { date: contract.cancelledAt ? day(contract.cancelledAt) : "" })} —{" "}
          {contract.cancelReason}
        </Alert>
      ) : null}
      {contract.notes ? <p className="text-sm whitespace-pre-wrap">{contract.notes}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("coveredAssets")}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCoveredAssets")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {contract.assets.map((a) => (
                <li key={a.id}>
                  <Link href={`/assets/${a.id}`} className="text-primary hover:underline">
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("schedules")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contract.schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSchedules")}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {contract.schedules.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-semibold">{s.title}</h3>
                    <ScheduleStateBadge state={s.active ? s.state : "finished"} />
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("intervalMonths")}</dt>
                      <dd dir="ltr">{s.intervalMonths}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("nextVisit")}</dt>
                      <dd>{s.nextDue ? day(s.nextDue) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("lastVisit")}</dt>
                      <dd>{s.lastDoneAt ? day(s.lastDoneAt) : t("never")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("assignee")}</dt>
                      <dd>{s.assigneeName ?? t("unassigned")}</dd>
                    </div>
                  </dl>
                  {live ? (
                    <ScheduleActions
                      scheduleId={s.id}
                      title={s.title}
                      intervalMonths={s.intervalMonths}
                      anchorDate={isoDay(s.anchorDate)}
                      assigneeId={s.assigneeId ?? ""}
                      active={s.active}
                      canPerform={can(role, "maintenance:perform")}
                      canManage={canManage}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage && live ? <AddSchedule contractId={id} staff={staff} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("visits")}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noVisits")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {contract.reports.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="mb-1 text-xs text-muted-foreground">{day(r.performedAt)}</p>
                  <p className="whitespace-pre-wrap">{r.summary}</p>
                  {r.partsReplaced ? (
                    <p className="mt-1 text-xs text-muted-foreground">{r.partsReplaced}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {canManage && live ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("cancelContract")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CancelContract contractId={id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
