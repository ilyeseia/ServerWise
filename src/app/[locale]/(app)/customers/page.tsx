import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { CustomerStatusBadge } from "@/components/crm/badges";
import { Pagination } from "@/components/crm/pagination";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/locale";
import { listCustomers } from "@/modules/crm/customers";
import { wilayaName } from "@/modules/crm/wilayas";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { actionContext } from "@/server/actions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }>;
};

const TYPES = ["individual", "business"] as const;
const STATUSES = ["prospect", "active", "archived"] as const;
const pick = <T extends string>(list: readonly T[], v: string | undefined) =>
  list.find((x) => x === v);

export default async function CustomersPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requirePagePermission("crm:read");
  const sp = await searchParams;

  const [t, tt, format] = await Promise.all([
    getTranslations("Crm.customers"),
    getTranslations("Crm.type"),
    getAppFormatter(),
  ]);
  const result = await listCustomers(await actionContext(), {
    q: sp.q,
    type: pick(TYPES, sp.type),
    status: pick(STATUSES, sp.status),
    page: Number(sp.page) || 1,
  });
  const filtered = Boolean(sp.q || sp.type || sp.status);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "crm:write") ? (
          <Link href="/customers/new" className={buttonVariants()}>
            {t("add")}
          </Link>
        ) : null}
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            {t("searchPlaceholder")}
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="type" className="text-sm font-medium">
            {t("filterType")}
          </label>
          <Select id="type" name="type" defaultValue={pick(TYPES, sp.type) ?? ""}>
            <option value="">—</option>
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {tt(v)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("filterStatus")}
          </label>
          <StatusSelect value={pick(STATUSES, sp.status)} />
        </div>
        <Button type="submit">{(await getTranslations("Crm.common"))("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{filtered ? t("noMatches") : t("empty")}</p>
      ) : (
        <>
          <Table caption={t("table")}>
            <thead>
              <tr>
                <Th>{t("name")}</Th>
                <Th>{t("type")}</Th>
                <Th>{t("phone")}</Th>
                <Th>{t("wilaya")}</Th>
                <Th>{t("status")}</Th>
                <Th>{t("openLeads")}</Th>
                <Th>{t("created")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.email ? (
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {c.email}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{tt(c.type)}</Td>
                  <Td dir="ltr">{c.phone ?? "—"}</Td>
                  <Td>{wilayaName(c.wilayaCode, locale) ?? "—"}</Td>
                  <Td>
                    <CustomerStatusBadge status={c.status} />
                  </Td>
                  <Td>{format.number(c.openLeads)}</Td>
                  <Td className="whitespace-nowrap">
                    {format.dateTime(c.createdAt, { dateStyle: "medium" })}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/customers"
            params={{ q: sp.q, type: sp.type, status: sp.status }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}

async function StatusSelect({ value }: { value: (typeof STATUSES)[number] | undefined }) {
  const ts = await getTranslations("Crm.customerStatus");
  return (
    <Select id="status" name="status" defaultValue={value ?? ""}>
      <option value="">—</option>
      {STATUSES.map((v) => (
        <option key={v} value={v}>
          {ts(v)}
        </option>
      ))}
    </Select>
  );
}
