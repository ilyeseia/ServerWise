import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getLead, listAssignableUsers } from "@/modules/crm/leads";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { LeadForm } from "../../lead-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function EditLeadPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  await requirePagePermission("crm:write");
  const ctx = await actionContext();
  const [t, lead, owners] = await Promise.all([
    getTranslations("Crm.leads"),
    orNotFound(getLead(ctx, id)),
    listAssignableUsers(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <LeadForm
        leadId={lead.id}
        lockedCustomer={lead.customer.name}
        customers={[]}
        owners={owners}
        initial={{
          customerId: lead.customerId,
          title: lead.title,
          source: lead.source,
          budgetMinDzd: lead.budgetMinDzd?.toString() ?? "",
          budgetMaxDzd: lead.budgetMaxDzd?.toString() ?? "",
          ownerId: lead.ownerId ?? "",
          notes: lead.notes ?? "",
        }}
      />
    </div>
  );
}
