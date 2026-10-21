import { getTranslations, setRequestLocale } from "next-intl/server";
import { RenewalBadge } from "@/components/care/badges";
import { Pagination } from "@/components/crm/pagination";
import { Badge } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listAssets } from "@/modules/careops/assets";
import { ASSET_KINDS, ASSET_STATUSES } from "@/modules/careops/schemas";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    kind?: string;
    status?: string;
    customerId?: string;
    page?: string;
  }>;
};

export default async function AssetsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("asset:read");
  const sp = await searchParams;
  const kind = ASSET_KINDS.find((k) => k === sp.kind);
  const status = ASSET_STATUSES.find((s) => s === sp.status);

  const [t, tKind, tStatus, tCrm, format] = await Promise.all([
    getTranslations("Assets"),
    getTranslations("Assets.kind"),
    getTranslations("Assets.status"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listAssets(await actionContext(), {
    q: sp.q,
    kind,
    status,
    customerId: sp.customerId,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "asset:write") ? (
          <Link
            href={sp.customerId ? `/assets/new?customerId=${sp.customerId}` : "/assets/new"}
            className={buttonVariants()}
          >
            {t("add")}
          </Link>
        ) : null}
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        {sp.customerId ? <input type="hidden" name="customerId" value={sp.customerId} /> : null}
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            {t("search")}
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kind" className="text-sm font-medium">
            {t("kindLabel")}
          </label>
          <Select id="kind" name="kind" defaultValue={kind ?? ""}>
            <option value="">{t("all")}</option>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("statusLabel")}
          </label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">{t("all")}</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">{tCrm("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">
          {sp.q || kind || status ? t("noMatches") : t("empty")}
        </p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("name")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("kindLabel")}</Th>
                <Th>{t("serial")}</Th>
                <Th>{t("statusLabel")}</Th>
                <Th>{t("warrantyUntil")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      href={`/assets/${a.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.brandModel ? (
                      <span className="ms-2 text-xs text-muted-foreground">{a.brandModel}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Link href={`/customers/${a.customerId}`} className="hover:underline">
                      {a.customerName}
                    </Link>
                  </Td>
                  <Td>{tKind(a.kind)}</Td>
                  <Td dir="ltr">{a.serialNumber ?? "—"}</Td>
                  <Td>
                    <Badge tone={a.status === "faulty" ? "danger" : "neutral"}>
                      {tStatus(a.status)}
                    </Badge>
                  </Td>
                  <Td>
                    {a.warrantyUntil ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span dir="ltr">
                          {format.dateTime(a.warrantyUntil, { dateStyle: "medium" })}
                        </span>
                        <RenewalBadge state={a.warranty} />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("unknown")}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/assets"
            params={{ q: sp.q, kind: sp.kind, status: sp.status, customerId: sp.customerId }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
