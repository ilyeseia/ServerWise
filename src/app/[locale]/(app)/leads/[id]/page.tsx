import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { LeadStatusBadge } from "@/components/crm/badges";
import { CommunicationsPanel } from "@/components/crm/communications-panel";
import { FollowUpsPanel } from "@/components/crm/followups-panel";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listCommunications } from "@/modules/crm/communications";
import { listFollowUps } from "@/modules/crm/followups";
import { allowedNextStatuses, isClosed } from "@/modules/crm/lead-status";
import { getLead, listAssignableUsers } from "@/modules/crm/leads";
import { getRequirements } from "@/modules/questionnaire/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { RequirementsForm } from "../requirements-form";
import { LeadStatusControl } from "../status-control";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function LeadPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("crm:read");
  const ctx = await actionContext();

  const lead = await orNotFound(getLead(ctx, id));
  const [t, tSource, tReq, format, requirements, followUps, communications, assignees] =
    await Promise.all([
      getTranslations("Crm.leads"),
      getTranslations("Crm.leadSource"),
      getTranslations("Crm.customer"),
      getAppFormatter(),
      getRequirements(ctx, id),
      listFollowUps(ctx, { leadId: id, status: "open", pageSize: 50 }),
      listCommunications(ctx, { leadId: id }, 50),
      listAssignableUsers(ctx),
    ]);
  const tr = await getTranslations("Requirements");

  const closed = isClosed(lead.status);
  const customerArchived = lead.customer.status === "archived";
  const canWrite = can(session.actor.role, "crm:write") && !customerArchived;
  const dt = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const money = (v: { toString(): string } | null) =>
    v ? format.number(Number(v.toString())) : "…";

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/customers/${lead.customerId}`} className="text-sm text-primary hover:underline">
        ← {lead.customer.name}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{lead.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <LeadStatusBadge status={lead.status} />
            <span className="text-muted-foreground">{tSource(lead.source)}</span>
            <span className="text-muted-foreground">
              {t("owner")}: {lead.owner?.name ?? t("unassigned")}
            </span>
            {lead.budgetMinDzd || lead.budgetMaxDzd ? (
              <span className="text-muted-foreground" dir="ltr">
                {money(lead.budgetMinDzd)} – {money(lead.budgetMaxDzd)} DZD
              </span>
            ) : null}
          </div>
          {lead.status === "lost" && lead.lostReason ? (
            <p className="text-sm text-danger">
              {t("lostReason")}: {lead.lostReason}
            </p>
          ) : null}
          {lead.closedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("closedOn", { date: format.dateTime(lead.closedAt, { dateStyle: "medium" }) })}
            </p>
          ) : null}
        </div>
        {canWrite && !closed ? (
          <Link
            href={`/leads/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("editTitle")}
          </Link>
        ) : null}
      </header>

      {customerArchived ? <Alert>{tReq("archivedNotice")}</Alert> : null}
      {lead.notes ? <p className="text-sm whitespace-pre-wrap">{lead.notes}</p> : null}

      {canWrite ? (
        <Card>
          <CardContent className="pt-6">
            <LeadStatusControl leadId={id} next={allowedNextStatuses(lead.status)} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{tr("title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{tr("subtitle")}</p>
        </CardHeader>
        <CardContent>
          <RequirementsForm
            // Remount when the saved state changes so the form reflects the server's answer.
            key={`${requirements.updatedAt?.toISOString() ?? "new"}-${lead.status}`}
            leadId={id}
            definition={requirements.definition}
            initialAnswers={requirements.answers}
            initialStatus={requirements.status}
            saved={requirements.saved}
            canEdit={canWrite && !closed}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tReq("followUps")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FollowUpsPanel
            canWrite={canWrite}
            create={{
              customerId: lead.customerId,
              leadId: id,
              assignees,
              defaultAssigneeId: session.actor.id,
            }}
            items={followUps.items.map((f) => ({
              id: f.id,
              title: f.title,
              dueLabel: dt(f.dueAt),
              overdue: f.overdue,
              status: f.status,
              customerId: f.customerId,
              customerName: f.customerName,
              leadId: f.leadId,
              leadTitle: f.leadTitle,
              assignedToName: f.assignedToName,
              notes: f.notes,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tReq("communications")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CommunicationsPanel
            customerId={lead.customerId}
            leadId={id}
            canWrite={canWrite}
            items={communications.map((c) => ({
              id: c.id,
              channel: c.channel,
              direction: c.direction,
              whenLabel: dt(c.occurredAt),
              summary: c.summary,
              leadId: c.leadId,
              leadTitle: c.leadTitle,
              authorName: c.authorName,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
