import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfferStateBadge } from "@/components/catalog/badges";
import { ProductActiveControl, VerifyControls } from "@/components/catalog/offer-controls";
import { RecordOfferPanel } from "@/components/catalog/record-offer-panel";
import { Alert, Badge } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { ageInDays } from "@/modules/catalog/freshness";
import { getProduct } from "@/modules/catalog/products";
import { listSuppliers } from "@/modules/catalog/suppliers";
import { wilayaName } from "@/modules/crm/wilayas";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function ProductPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const session = await requirePagePermission("catalog:read");
  const role = session.actor.role;
  const ctx = await actionContext();

  const product = await orNotFound(getProduct(ctx, id));
  const [t, tSpec, tCat, tGpu, tNoise, tOffer, tUnits, format, suppliers] = await Promise.all([
    getTranslations("Catalog.detail"),
    getTranslations("Catalog.spec"),
    getTranslations("Catalog.categories"),
    getTranslations("Catalog.gpu"),
    getTranslations("Catalog.noise"),
    getTranslations("Catalog.offer"),
    getTranslations("Advisor.units"),
    getAppFormatter(),
    listSuppliers(ctx),
  ]);
  const tCatalog = await getTranslations("Catalog");

  const canWrite = can(role, "catalog:write") && product.active;
  const canVerify = can(role, "catalog:verify");
  const now = new Date();
  const unknown = tCatalog("unknown");
  const num = (v: number | null, unit?: string) =>
    v === null ? unknown : unit ? `${format.number(v)} ${unit}` : format.number(v);
  const yesNo = (v: boolean | null) =>
    v === null ? unknown : v ? tCatalog("yes") : tCatalog("no");

  const specs: [string, string, boolean?][] = [
    [tSpec("category"), tCat(product.category)],
    [tSpec("cpuModel"), product.cpuModel ?? unknown],
    [tSpec("cpuCores"), num(product.cpuCores)],
    [tSpec("cpuBenchmark"), num(product.cpuBenchmark)],
    [tSpec("ramGb"), num(product.ramGb, tUnits("gb"))],
    [tSpec("ramMaxGb"), num(product.ramMaxGb, tUnits("gb"))],
    [tSpec("ecc"), yesNo(product.ecc)],
    [tSpec("storageSlots"), num(product.storageSlots)],
    [
      tSpec("storageMaxTb"),
      product.storageMaxTb
        ? `${format.number(Number(product.storageMaxTb.toString()))} ${tUnits("tb")}`
        : unknown,
    ],
    [tSpec("lanPorts"), num(product.lanPorts)],
    [tSpec("lanSpeedMbps"), num(product.lanSpeedMbps)],
    [tSpec("hasWifi"), yesNo(product.hasWifi)],
    [tSpec("gpuClass"), product.gpuClass ? tGpu(product.gpuClass) : unknown],
    [tSpec("noiseClass"), product.noiseClass ? tNoise(product.noiseClass) : unknown],
    [tSpec("idleWatts"), num(product.idleWatts, tUnits("watts"))],
    [tSpec("maxWatts"), num(product.maxWatts, tUnits("watts"))],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/catalog" className="text-sm text-primary hover:underline">
        ← {t("back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">
            {product.brand} {product.model}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{tCat(product.category)}</Badge>
            {!product.active ? <Badge tone="danger">{tCatalog("inactive")}</Badge> : null}
          </div>
        </div>
        {can(role, "catalog:write") ? (
          <div className="flex flex-wrap items-start gap-2">
            {product.active ? (
              <Link
                href={`/catalog/${id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("edit")}
              </Link>
            ) : null}
            <ProductActiveControl productId={id} active={product.active} />
          </div>
        ) : null}
      </header>

      {!product.active ? <Alert>{t("inactiveNotice")}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("specs")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {specs.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={value === unknown ? "text-muted-foreground" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          {product.cpuBenchmarkSource ? (
            <a
              className="text-sm text-primary hover:underline"
              href={product.cpuBenchmarkSource}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
            >
              {tSpec("cpuBenchmarkSource")}
            </a>
          ) : null}
          {product.specsSource ? (
            <a
              className="text-sm text-primary hover:underline"
              href={product.specsSource}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
            >
              {tSpec("specsSource")}
            </a>
          ) : null}
          {product.notes ? <p className="text-sm whitespace-pre-wrap">{product.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("offers")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("historyNote")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("bestPrice")}: </span>
            {product.bestPrice ? (
              <strong data-testid="best-price" dir="ltr">
                {format.number(product.bestPrice.priceDzd)} {tUnits("dzd")} ·{" "}
                {product.bestPrice.supplierName}
              </strong>
            ) : (
              <span data-testid="best-price">{tCatalog("noPrice")}</span>
            )}
          </p>

          {product.offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noOffers")}</p>
          ) : (
            <Table caption={t("offers")}>
              <thead>
                <tr>
                  <Th>{tOffer("supplier")}</Th>
                  <Th>{tOffer("price")}</Th>
                  <Th>{tOffer("condition")}</Th>
                  <Th>{tOffer("availability")}</Th>
                  <Th>{tOffer("checkedAt")}</Th>
                  <Th>{tOffer("state")}</Th>
                  <Th>{tOffer("source")}</Th>
                  {canVerify ? <Th>{tOffer("verification")}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {product.offers.map((o) => {
                  const days = ageInDays(o.checkedAt, now);
                  return (
                    <tr key={o.id} data-testid="offer-row" data-state={o.state}>
                      <Td>
                        {o.supplierName}
                        {!o.current ? (
                          <div className="text-xs text-muted-foreground">{t("superseded")}</div>
                        ) : null}
                      </Td>
                      <Td dir="ltr" className="font-medium whitespace-nowrap">
                        {format.number(Number(o.priceDzd))} {tUnits("dzd")}
                      </Td>
                      <Td>
                        {tOffer(`conditions.${o.condition}`)}
                        {o.warrantyMonths !== null ? (
                          <div className="text-xs text-muted-foreground">
                            {format.number(o.warrantyMonths)} {tUnits("months")}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        {tOffer(`availabilities.${o.availability as "in_stock"}`)}
                        {o.locationWilayaCode ? (
                          <div className="text-xs text-muted-foreground">
                            {wilayaName(o.locationWilayaCode, locale)}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {format.dateTime(o.checkedAt, { dateStyle: "medium" })}
                        <div className="text-xs text-muted-foreground">
                          {days === 0 ? tOffer("today") : tOffer("daysAgo", { days })}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <OfferStateBadge state={o.state} />
                          <span className="text-xs text-muted-foreground">
                            {tOffer(`verificationStatus.${o.verificationStatus}`)}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        {o.sourceUrl ? (
                          <a
                            href={o.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                            dir="ltr"
                          >
                            {tOffer("openSource")}
                          </a>
                        ) : null}
                        {o.quoteReference ? (
                          <div dir="auto" className="text-xs">
                            {o.quoteReference}
                          </div>
                        ) : null}
                      </Td>
                      {canVerify ? (
                        <Td>
                          {o.verificationStatus === "unverified" ? (
                            <VerifyControls offerId={o.id} />
                          ) : o.verifiedAt ? (
                            <span className="text-xs text-muted-foreground">
                              {tOffer("verifiedOn", {
                                date: format.dateTime(o.verifiedAt, { dateStyle: "medium" }),
                              })}
                            </span>
                          ) : null}
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {canWrite ? (
            <RecordOfferPanel
              productId={id}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
