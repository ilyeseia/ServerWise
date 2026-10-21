import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContractForm } from "@/components/care/contract-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listAssets } from "@/modules/careops/assets";
import { getContract } from "@/modules/careops/maintenance";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

const day = (date: Date) => date.toISOString().slice(0, 10);

export default async function EditContractPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  await requirePagePermission("maintenance:write");
  const ctx = await actionContext();
  const contract = await orNotFound(getContract(ctx, id));
  const assets = await listAssets(ctx, { customerId: contract.customer.id, pageSize: 100 });
  const t = await getTranslations("Maintenance");

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/maintenance/${id}`} className="text-sm text-primary hover:underline">
        ← {contract.title}
      </Link>
      <h1 className="text-2xl font-bold">{t("edit")}</h1>
      <ContractForm
        contractId={id}
        customerId={contract.customer.id}
        customers={[contract.customer]}
        assets={assets.items
          .filter((a) => a.status !== "retired" || contract.assets.some((c) => c.id === a.id))
          .map((a) => ({ id: a.id, name: a.name }))}
        initial={{
          title: contract.title,
          startsAt: day(contract.startsAt),
          endsAt: day(contract.endsAt),
          monthlyFeeDzd: contract.monthlyFeeDzd ?? "",
          notes: contract.notes ?? "",
          assetIds: contract.assets.map((a) => a.id),
        }}
      />
    </div>
  );
}
