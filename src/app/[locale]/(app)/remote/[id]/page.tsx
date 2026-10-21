import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanStatusBadge } from "@/components/backups/badges";
import { PlanControls, PlanForm } from "@/components/backups/plan-form";
import type { PlanFormValues } from "@/components/backups/policy-values";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getPlan } from "@/modules/backups/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function PlanPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("remote:read");
  const role = session.actor.role;
  const [plan, t, tSafe, tOwner, format] = await Promise.all([
    orNotFound(getPlan(await actionContext(), id)),
    getTranslations("Remote"),
    getTranslations("Remote.safeguard"),
    getTranslations("Remote.owner"),
    getAppFormatter(),
  ]);
  const day = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "");

  const initial: PlanFormValues = {
    customerId: plan.customerId,
    title: plan.title,
    tailnetOwner: plan.tailnetOwner,
    devices: plan.devices ?? "",
    aclNotes: plan.aclNotes ?? "",
    deviceApproval: plan.deviceApproval,
    keyExpiry: plan.keyExpiry,
    noPublicExposure: plan.noPublicExposure,
    noSubnetOrExit: plan.noSubnetOrExit,
    mfa: plan.mfa,
    exceptions: plan.exceptions ?? "",
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href="/remote" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{plan.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <PlanStatusBadge status={plan.status} />
          <Link href={`/customers/${plan.customer.id}`} className="hover:underline">
            {plan.customer.name}
          </Link>
          {plan.approvedAt ? (
            <span className="text-muted-foreground">
              {t("approvedOn", { date: day(plan.approvedAt) })}
            </span>
          ) : null}
          {plan.retiredAt ? (
            <span className="text-muted-foreground">
              {t("retiredOn", { date: day(plan.retiredAt) })}
            </span>
          ) : null}
        </div>
      </header>

      {plan.gaps.length > 0 ? (
        <Alert>
          <strong>{t("gapsTitle")}:</strong>{" "}
          {plan.gaps
            .map((gap) => (gap === "provider_tailnet" ? tOwner("provider") : tSafe(gap)))
            .join(" · ")}
          {plan.status === "draft" && !plan.exceptions ? ` — ${t("exceptionsNeeded")}` : ""}
        </Alert>
      ) : null}
      {plan.status !== "draft" ? <Alert>{t("lockedNotice")}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("planDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanForm
            key={`${plan.status}-${plan.updatedAt.toISOString()}`}
            planId={id}
            initial={initial}
            customers={[plan.customer]}
            customerLocked
            readOnly={plan.status !== "draft" || !can(role, "remote:write")}
          />
        </CardContent>
      </Card>

      {can(role, "remote:approve") || can(role, "remote:write") ? (
        <Card>
          <CardContent className="pt-6">
            <PlanControls
              key={plan.status}
              planId={id}
              status={plan.status}
              canApprove={can(role, "remote:approve")}
              canRetire={can(role, "remote:write")}
              approvable={plan.approvable}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
