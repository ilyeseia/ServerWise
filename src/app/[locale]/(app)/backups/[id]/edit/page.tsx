import { getTranslations, setRequestLocale } from "next-intl/server";
import { PolicyForm } from "@/components/backups/policy-form";
import type { PolicyFormValues } from "@/components/backups/policy-values";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import type { BACKUP_KINDS } from "@/modules/backups/schemas";
import { getPolicy } from "@/modules/backups/service";
import { listAssets } from "@/modules/careops/assets";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

const tri = (value: boolean | null) => (value === null ? "" : String(value));

export default async function EditPolicyPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("backup:write");
  const ctx = await actionContext();
  const policy = await orNotFound(getPolicy(ctx, id));
  const t = await getTranslations("Backups");
  const assets = can(session.actor.role, "asset:read")
    ? await listAssets(ctx, { customerId: policy.customer.id, pageSize: 100 })
    : { items: [] };

  const initial: PolicyFormValues = {
    customerId: policy.customer.id,
    assetId: policy.asset?.id ?? "",
    name: policy.name,
    kind: policy.kind as (typeof BACKUP_KINDS)[number],
    frequencyDays: String(policy.frequencyDays),
    retentionDays: policy.retentionDays === null ? "" : String(policy.retentionDays),
    destination: policy.destination,
    encrypted: tri(policy.encrypted),
    encryptionKeyRef: policy.encryptionKeyRef ?? "",
    offsite: tri(policy.offsite),
    restoreTestEveryDays: String(policy.restoreTestEveryDays),
    active: policy.active,
    notes: policy.notes ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/backups/${id}`} className="text-sm text-primary hover:underline">
        ← {policy.name}
      </Link>
      <h1 className="text-2xl font-bold">{t("editPolicy")}</h1>
      <PolicyForm
        policyId={id}
        initial={initial}
        customers={[policy.customer]}
        assets={assets.items.map((a) => ({ id: a.id, name: a.name }))}
        customerLocked
        recoveryProcedure={policy.recoveryProcedure ?? ""}
      />
    </div>
  );
}
