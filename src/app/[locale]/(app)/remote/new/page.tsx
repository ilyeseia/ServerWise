import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanForm } from "@/components/backups/plan-form";
import { EMPTY_PLAN } from "@/components/backups/policy-values";
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

export default async function NewPlanPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  await requirePagePermission("remote:write");
  const { customerId = "" } = await searchParams;
  const t = await getTranslations("Remote");
  const customers = await listCustomers(await actionContext(), { pageSize: 100 });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/remote" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>
      <h1 className="text-2xl font-bold">{t("newPlan")}</h1>
      <PlanForm
        initial={{ ...EMPTY_PLAN, customerId }}
        customers={customers.items.map((c) => ({ id: c.id, name: c.name }))}
        customerLocked={false}
        readOnly={false}
      />
    </div>
  );
}
