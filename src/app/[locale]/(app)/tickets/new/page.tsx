import { getTranslations, setRequestLocale } from "next-intl/server";
import { TicketForm } from "@/components/care/ticket-form";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listAssets } from "@/modules/careops/assets";
import { listTicketStaff } from "@/modules/careops/tickets";
import { listCustomers } from "@/modules/crm/customers";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewTicketPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("ticket:write");
  const { customerId = "" } = await searchParams;
  const ctx = await actionContext();
  const t = await getTranslations("Tickets");

  const [customers, staff, assets] = await Promise.all([
    listCustomers(ctx, { pageSize: 100 }),
    listTicketStaff(ctx),
    customerId && can(session.actor.role, "asset:read")
      ? listAssets(ctx, { customerId, pageSize: 100 })
      : Promise.resolve({ items: [] }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/tickets" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>
      <h1 className="text-2xl font-bold">{t("open")}</h1>
      <TicketForm
        // A new key resets the form when another customer is chosen.
        key={customerId}
        customers={customers.items.map((c) => ({ id: c.id, name: c.name }))}
        customerId={customerId}
        assets={assets.items
          .filter((a) => a.status !== "retired")
          .map((a) => ({ id: a.id, name: a.name }))}
        staff={staff}
      />
    </div>
  );
}
