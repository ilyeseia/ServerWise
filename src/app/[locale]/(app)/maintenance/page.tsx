import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContractStateBadge, ScheduleStateBadge } from "@/components/care/badges";
import { GenerateReminders } from "@/components/care/contract-controls";
import { Pagination } from "@/components/crm/pagination";
import { buttonVariants } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatLocaleTag } from "@/i18n/routing";
import { listContracts, listDueMaintenance } from "@/modules/careops/maintenance";
import { formatMoney } from "@/modules/quotes/format";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customerId?: string; page?: string }>;
};

export default async function MaintenancePage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requirePagePermission("maintenance:read");
  const sp = await searchParams;
  const ctx = await actionContext();
  const role = session.actor.role;

  const [t, format, due, contracts] = await Promise.all([
    getTranslations("Maintenance"),
    getAppFormatter(),
    listDueMaintenance(ctx),
    listContracts(ctx, { customerId: sp.customerId, page: Number(sp.page) || 1 }),
  ]);
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(role, "maintenance:write") ? (
          <Link
            href={
              sp.customerId ? `/maintenance/new?customerId=${sp.customerId}` : "/maintenance/new"
            }
            className={buttonVariants()}
          >
            {t("newContract")}
          </Link>
        ) : null}
      </header>

      <section aria-labelledby="due-heading" className="flex flex-col gap-3">
        <h2 id="due-heading" className="text-lg font-semibold">
          {t("dueNow")}
        </h2>
        {due.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nothingDue")}</p>
        ) : (
          <Table caption={t("dueTable")}>
            <thead>
              <tr>
                <Th>{t("scheduleTitle")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("nextVisit")}</Th>
                <Th>{t("scheduleStateLabel")}</Th>
                <Th>{t("assignee")}</Th>
              </tr>
            </thead>
            <tbody>
              {due.map((d) => (
                <tr key={d.scheduleId}>
                  <Td>
                    <Link
                      href={`/maintenance/${d.contractId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {d.scheduleTitle}
                    </Link>
                  </Td>
                  <Td>{d.customerName}</Td>
                  <Td>{day(d.nextDue)}</Td>
                  <Td>
                    <ScheduleStateBadge state={d.state} />
                  </Td>
                  <Td>{d.assigneeName ?? t("unassigned")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {can(role, "maintenance:write") ? <GenerateReminders /> : null}
      </section>

      <section aria-labelledby="contracts-heading" className="flex flex-col gap-3">
        <h2 id="contracts-heading" className="text-lg font-semibold">
          {t("contracts")}
        </h2>
        {contracts.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noContracts")}</p>
        ) : (
          <>
            <Table caption={t("contractsTable")}>
              <thead>
                <tr>
                  <Th>{t("titleLabel")}</Th>
                  <Th>{t("customer")}</Th>
                  <Th>{t("period")}</Th>
                  <Th>{t("stateLabel")}</Th>
                  <Th>{t("monthlyFee")}</Th>
                  <Th>{t("coveredAssets")}</Th>
                </tr>
              </thead>
              <tbody>
                {contracts.items.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link
                        href={`/maintenance/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.title}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/customers/${c.customerId}`} className="hover:underline">
                        {c.customerName}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {day(c.startsAt)} → {day(c.endsAt)}
                    </Td>
                    <Td>
                      <ContractStateBadge state={c.state} />
                    </Td>
                    <Td dir="ltr" className="whitespace-nowrap">
                      {c.monthlyFeeDzd
                        ? `${formatMoney(c.monthlyFeeDzd, formatLocaleTag[locale])} ${t("currency")}`
                        : "—"}
                    </Td>
                    <Td>{format.number(c.assets)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              pathname="/maintenance"
              params={{ customerId: sp.customerId }}
              page={contracts.page}
              pageSize={contracts.pageSize}
              total={contracts.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
