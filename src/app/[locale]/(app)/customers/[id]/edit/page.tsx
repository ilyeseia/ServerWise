import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getCustomer } from "@/modules/crm/customers";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { CustomerForm, type CustomerFormValues } from "../../customer-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function EditCustomerPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  await requirePagePermission("crm:write");
  const [t, customer] = await Promise.all([
    getTranslations("Crm.customerForm"),
    orNotFound(getCustomer(await actionContext(), id)),
  ]);

  const initial: CustomerFormValues = {
    type: customer.type,
    name: customer.name,
    legalName: customer.legalName ?? "",
    taxId: customer.taxId ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    wilayaCode: customer.wilayaCode?.toString() ?? "",
    address: customer.address ?? "",
    preferredLanguage: customer.preferredLanguage,
    notes: customer.notes ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <CustomerForm customerId={customer.id} initial={initial} />
    </div>
  );
}
