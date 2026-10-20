import { setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { listSuppliers } from "@/modules/catalog/suppliers";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { SuppliersManager, type SupplierRow } from "./suppliers-manager";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SuppliersPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("catalog:read");
  const suppliers = await listSuppliers(await actionContext(), { includeInactive: true });

  return (
    <SuppliersManager
      suppliers={suppliers as SupplierRow[]}
      canWrite={can(session.actor.role, "catalog:write")}
    />
  );
}
