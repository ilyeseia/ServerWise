import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssetForm } from "@/components/care/asset-form";
import type { AssetFormValues } from "@/components/care/asset-values";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getAsset } from "@/modules/careops/assets";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");

export default async function EditAssetPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  await requirePagePermission("asset:write");
  const asset = await orNotFound(getAsset(await actionContext(), id));
  const t = await getTranslations("Assets");

  const initial: AssetFormValues = {
    customerId: asset.customerId,
    kind: asset.kind,
    name: asset.name,
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? "",
    os: asset.os ?? "",
    version: asset.version ?? "",
    location: asset.location ?? "",
    installedAt: day(asset.installedAt),
    warrantyUntil: day(asset.warrantyUntil),
    renewsAt: day(asset.renewsAt),
    status: asset.status,
    credentialsRef: asset.credentialsRef ?? "",
    notes: asset.notes ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/assets/${id}`} className="text-sm text-primary hover:underline">
        ← {asset.name}
      </Link>
      <h1 className="text-2xl font-bold">{t("edit")}</h1>
      <AssetForm
        assetId={id}
        initial={initial}
        customers={[{ id: asset.customer.id, name: asset.customer.name }]}
        customerLocked
      />
    </div>
  );
}
