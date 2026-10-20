import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getCustomer, listCustomers } from "@/modules/crm/customers";
import { listAssignableUsers } from "@/modules/crm/leads";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { LeadForm } from "../lead-form";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewLeadPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("crm:write");
  const { customerId } = await searchParams;
  const ctx = await actionContext();

  const [t, owners] = await Promise.all([getTranslations("Crm.leads"), listAssignableUsers(ctx)]);
  const locked = customerId ? await orNotFound(getCustomer(ctx, customerId)) : null;
  const customers = locked
    ? []
    : (await listCustomers(ctx, { pageSize: 100 })).items.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("createTitle")}</h1>
      <LeadForm
        initial={{
          customerId: locked?.id ?? "",
          title: "",
          source: "other",
          budgetMinDzd: "",
          budgetMaxDzd: "",
          ownerId: session.actor.id,
          notes: "",
        }}
        customers={customers}
        owners={owners}
        lockedCustomer={locked?.name}
      />
    </div>
  );
}
