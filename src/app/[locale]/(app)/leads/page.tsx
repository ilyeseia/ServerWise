import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { LeadStatusBadge } from "@/components/crm/badges";
import { Pagination } from "@/components/crm/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { LEAD_STATUSES } from "@/modules/crm/lead-status";
import { listLeads } from "@/modules/crm/leads";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; mine?: string; page?: string }>;
};

export default async function LeadsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("crm:read");
  const sp = await searchParams;
  const status = LEAD_STATUSES.find((s) => s === sp.status);
  const mine = sp.mine === "1";

  const [t, ts, tSource, tCommon, format] = await Promise.all([
    getTranslations("Crm.leads"),
    getTranslations("Crm.leadStatus"),
    getTranslations("Crm.leadSource"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listLeads(await actionContext(), {
    q: sp.q,
    status,
    ownerId: mine ? session.actor.id : undefined,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "crm:write") ? (
          <Link href="/leads/new" className={buttonVariants()}>
            {t("add")}
          </Link>
        ) : null}
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            {t("searchPlaceholder")}
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("status")}
          </label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">{tCommon("all")}</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} />
          {t("owner")}: {session.actor.name}
        </label>
        <Button type="submit">{tCommon("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <Table caption={t("table")}>
            <thead>
              <tr>
                <Th>{t("titleField")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("status")}</Th>
                <Th>{t("source")}</Th>
                <Th>{t("owner")}</Th>
                <Th>{t("budget")}</Th>
                <Th>{t("created")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link
                      href={`/leads/${l.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {l.title}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${l.customerId}`} className="hover:underline">
                      {l.customerName}
                    </Link>
                  </Td>
                  <Td>
                    <LeadStatusBadge status={l.status} />
                  </Td>
                  <Td>{tSource(l.source as Parameters<typeof tSource>[0])}</Td>
                  <Td>{l.ownerName ?? "—"}</Td>
                  <Td dir="ltr" className="whitespace-nowrap">
                    {l.budgetMinDzd || l.budgetMaxDzd
                      ? `${l.budgetMinDzd ? format.number(Number(l.budgetMinDzd)) : "…"} – ${l.budgetMaxDzd ? format.number(Number(l.budgetMaxDzd)) : "…"}`
                      : "—"}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {format.dateTime(l.createdAt, { dateStyle: "medium" })}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/leads"
            params={{ q: sp.q, status: sp.status, mine: sp.mine }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
