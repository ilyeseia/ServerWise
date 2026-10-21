import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssetForm } from "@/components/care/asset-form";
import { EMPTY_ASSET } from "@/components/care/asset-values";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listCustomers } from "@/modules/crm/customers";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewAssetPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  await requirePagePermission("asset:write");
  const { customerId } = await searchParams;
  const t = await getTranslations("Assets");
  const customers = await listCustomers(await actionContext(), { pageSize: 100 });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/assets" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>
      <h1 className="text-2xl font-bold">{t("add")}</h1>
      <AssetForm
        initial={{ ...EMPTY_ASSET, customerId: customerId ?? "" }}
        customers={customers.items.map((c) => ({ id: c.id, name: c.name }))}
        customerLocked={false}
      />
    </div>
  );
}
