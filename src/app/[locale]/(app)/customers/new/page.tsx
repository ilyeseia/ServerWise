import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { requirePagePermission } from "@/server/auth/page-guard";
import { CustomerForm } from "../customer-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function NewCustomerPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  await requirePagePermission("crm:write");
  const t = await getTranslations("Crm.customerForm");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("createTitle")}</h1>
      <CustomerForm />
    </div>
  );
}
