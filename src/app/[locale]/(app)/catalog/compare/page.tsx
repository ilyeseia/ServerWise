import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfferStateBadge } from "@/components/catalog/badges";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { compareProducts } from "@/modules/catalog/products";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
};

export default async function ComparePage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  await requirePagePermission("catalog:read");
  const { ids } = await searchParams;
  const requested = (Array.isArray(ids) ? ids : ids ? [ids] : []).slice(0, 4);

  const [t, tSpec, tCat, tGpu, tNoise, tUnits, tCatalog, format] = await Promise.all([
    getTranslations("Catalog.detail"),
    getTranslations("Catalog.spec"),
    getTranslations("Catalog.categories"),
    getTranslations("Catalog.gpu"),
    getTranslations("Catalog.noise"),
    getTranslations("Advisor.units"),
    getTranslations("Catalog"),
    getAppFormatter(),
  ]);
  const products =
    requested.length >= 2 ? await compareProducts(await actionContext(), requested) : [];

  const unknown = tCatalog("unknown");
  const num = (v: number | null, unit?: string) =>
    v === null ? unknown : unit ? `${format.number(v)} ${unit}` : format.number(v);
  const yesNo = (v: boolean | null) =>
    v === null ? unknown : v ? tCatalog("yes") : tCatalog("no");

  type Product = (typeof products)[number];
  const rows: [string, (p: Product) => string][] = [
    [tSpec("category"), (p) => tCat(p.category)],
    [tSpec("cpuModel"), (p) => p.cpuModel ?? unknown],
    [tSpec("cpuCores"), (p) => num(p.cpuCores)],
    [tSpec("cpuBenchmark"), (p) => num(p.cpuBenchmark)],
    [tSpec("ramGb"), (p) => num(p.ramGb, tUnits("gb"))],
    [tSpec("ramMaxGb"), (p) => num(p.ramMaxGb, tUnits("gb"))],
    [tSpec("ecc"), (p) => yesNo(p.ecc)],
    [tSpec("storageSlots"), (p) => num(p.storageSlots)],
    [
      tSpec("storageMaxTb"),
      (p) =>
        p.storageMaxTb
          ? `${format.number(Number(p.storageMaxTb.toString()))} ${tUnits("tb")}`
          : unknown,
    ],
    [tSpec("lanPorts"), (p) => num(p.lanPorts)],
    [tSpec("lanSpeedMbps"), (p) => num(p.lanSpeedMbps)],
    [tSpec("hasWifi"), (p) => yesNo(p.hasWifi)],
    [tSpec("gpuClass"), (p) => (p.gpuClass ? tGpu(p.gpuClass) : unknown)],
    [tSpec("noiseClass"), (p) => (p.noiseClass ? tNoise(p.noiseClass) : unknown)],
    [tSpec("idleWatts"), (p) => num(p.idleWatts, tUnits("watts"))],
    [tSpec("maxWatts"), (p) => num(p.maxWatts, tUnits("watts"))],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/catalog" className="text-sm text-primary hover:underline">
        ← {t("back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("compareTitle")}</h1>

      {products.length < 2 ? (
        <p className="text-muted-foreground">{t("compareNeedTwo")}</p>
      ) : (
        <Table caption={t("compareTitle")}>
          <thead>
            <tr>
              <Th>{t("specColumn")}</Th>
              {products.map((p) => (
                <Th key={p.id}>
                  <Link href={`/catalog/${p.id}`} className="text-primary hover:underline">
                    {p.brand} {p.model}
                  </Link>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <Td className="font-medium text-muted-foreground">{label}</Td>
                {products.map((p) => {
                  const text = value(p);
                  return (
                    <Td
                      key={p.id}
                      className={text === unknown ? "text-muted-foreground" : undefined}
                    >
                      {text}
                    </Td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <Td className="font-medium text-muted-foreground">{t("bestPrice")}</Td>
              {products.map((p) => (
                <Td key={p.id}>
                  {p.bestPrice ? (
                    <div className="flex flex-col gap-0.5">
                      <strong dir="ltr">
                        {format.number(p.bestPrice.priceDzd)} {tUnits("dzd")}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {p.bestPrice.supplierName}
                      </span>
                      <OfferStateBadge state={p.bestPrice.state} />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{tCatalog("noPrice")}</span>
                  )}
                </Td>
              ))}
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  );
}
