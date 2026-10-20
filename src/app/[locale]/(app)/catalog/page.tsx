import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfferStateBadge } from "@/components/catalog/badges";
import { Pagination } from "@/components/crm/pagination";
import { Badge } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listProducts } from "@/modules/catalog/products";
import { PRODUCT_CATEGORIES } from "@/modules/catalog/schemas";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; category?: string; inactive?: string; page?: string }>;
};

export default async function CatalogPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requirePagePermission("catalog:read");
  const sp = await searchParams;
  const category = PRODUCT_CATEGORIES.find((c) => c === sp.category);
  const inactive = sp.inactive === "1";

  const [t, tCat, tUnits, tCrm, format] = await Promise.all([
    getTranslations("Catalog"),
    getTranslations("Catalog.categories"),
    getTranslations("Advisor.units"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listProducts(await actionContext(), {
    q: sp.q,
    category,
    includeInactive: inactive,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "catalog:write") ? (
          <Link href="/catalog/new" className={buttonVariants()}>
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
          <label htmlFor="category" className="text-sm font-medium">
            {t("category")}
          </label>
          <Select id="category" name="category" defaultValue={category ?? ""}>
            <option value="">{t("all")}</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tCat(c)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="inactive" value="1" defaultChecked={inactive} />
          {t("showInactive")}
        </label>
        <Button type="submit">{tCrm("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{sp.q || category ? t("noMatches") : t("empty")}</p>
      ) : (
        <>
          <form method="get" action={`/${locale}/catalog/compare`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" size="sm">
                {t("compare")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("compareHint")}</span>
            </div>
            <Table caption={t("table")}>
              <thead>
                <tr>
                  <Th>
                    <span className="sr-only">{t("compare")}</span>
                  </Th>
                  <Th>{t("product")}</Th>
                  <Th>{t("category")}</Th>
                  <Th>{t("cpu")}</Th>
                  <Th>{t("ram")}</Th>
                  <Th>{t("storage")}</Th>
                  <Th>{t("bestPrice")}</Th>
                  <Th>{t("observations")}</Th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <input
                        type="checkbox"
                        name="ids"
                        value={p.id}
                        aria-label={t("selectForCompare", { name: `${p.brand} ${p.model}` })}
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/catalog/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.brand} {p.model}
                      </Link>
                      {!p.active ? <Badge className="ms-2">{t("inactive")}</Badge> : null}
                    </Td>
                    <Td>{tCat(p.category as (typeof PRODUCT_CATEGORIES)[number])}</Td>
                    <Td>{p.cpuModel ?? t("unknown")}</Td>
                    <Td>
                      {p.ramGb !== null
                        ? `${format.number(p.ramGb)} ${tUnits("gb")}`
                        : t("unknown")}
                    </Td>
                    <Td>
                      {p.storageMaxTb
                        ? `${format.number(Number(p.storageMaxTb))} ${tUnits("tb")}`
                        : t("unknown")}
                    </Td>
                    <Td>
                      {p.bestPrice ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium" dir="ltr">
                            {format.number(p.bestPrice.priceDzd)} {tUnits("dzd")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {p.bestPrice.supplierName}
                          </span>
                          <OfferStateBadge state={p.bestPrice.state} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("noPrice")}</span>
                      )}
                    </Td>
                    <Td>{format.number(p.observations)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </form>
          <Pagination
            pathname="/catalog"
            params={{ q: sp.q, category: sp.category, inactive: sp.inactive }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
