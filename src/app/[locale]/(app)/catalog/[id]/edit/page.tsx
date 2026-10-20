import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getProduct } from "@/modules/catalog/products";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { ProductForm, type ProductFormValues } from "../../product-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

const str = (v: { toString(): string } | number | null | undefined) =>
  v === null || v === undefined ? "" : v.toString();
const tri = (v: boolean | null) => (v === null ? "" : v ? "true" : "false");

export default async function EditProductPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  await requirePagePermission("catalog:write");
  const [t, product] = await Promise.all([
    getTranslations("Catalog.form"),
    orNotFound(getProduct(await actionContext(), id)),
  ]);

  const initial: ProductFormValues = {
    category: product.category,
    brand: product.brand,
    model: product.model,
    cpuModel: str(product.cpuModel),
    cpuCores: str(product.cpuCores),
    cpuBenchmark: str(product.cpuBenchmark),
    cpuBenchmarkSource: str(product.cpuBenchmarkSource),
    ramGb: str(product.ramGb),
    ramMaxGb: str(product.ramMaxGb),
    storageSlots: str(product.storageSlots),
    storageMaxTb: str(product.storageMaxTb),
    lanPorts: str(product.lanPorts),
    lanSpeedMbps: str(product.lanSpeedMbps),
    hasWifi: tri(product.hasWifi),
    gpuClass: str(product.gpuClass),
    noiseClass: str(product.noiseClass),
    idleWatts: str(product.idleWatts),
    maxWatts: str(product.maxWatts),
    ecc: tri(product.ecc),
    specsSource: str(product.specsSource),
    notes: str(product.notes),
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <ProductForm productId={product.id} initial={initial} />
    </div>
  );
}
