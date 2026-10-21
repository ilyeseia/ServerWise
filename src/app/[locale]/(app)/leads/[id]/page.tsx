import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { LeadStatusBadge } from "@/components/crm/badges";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
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
import { getRecommendation, listRecommendations } from "@/modules/advisor/service";
import { getRequirements } from "@/modules/questionnaire/service";
import { listQuotes } from "@/modules/quotes/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { AiAssist } from "@/components/ai/ai-assist";
import { canRunTool } from "@/modules/ai/tools";
import { AdvisorResults } from "../advisor-results";
import { AdvisorRunner } from "../advisor-runner";
import { CreateQuote } from "../create-quote";
import { RequirementsForm } from "../requirements-form";
import { LeadStatusControl } from "../status-control";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ rec?: string }>;
};

export default async function LeadPage({ params, searchParams }: Props) {
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
  const tAdvisor = await getTranslations("Advisor");
  const tAi = await getTranslations("Ai");

  // The advisor needs both CRM and catalog access (technicians read results; sales can run it).
  const advisorVisible =
    can(session.actor.role, "crm:read") && can(session.actor.role, "catalog:read");
  const runs = advisorVisible ? await listRecommendations(ctx, id) : [];
  const { rec } = await searchParams;
  const selectedId = runs.find((r) => r.id === rec)?.id ?? runs[0]?.id;
  const selected = selectedId ? await getRecommendation(ctx, selectedId) : null;

  const quotesVisible = can(session.actor.role, "quote:read");
  const leadQuotes = quotesVisible ? await listQuotes(ctx, { leadId: id, pageSize: 50 }) : null;
  const tq = await getTranslations("Quotes");

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
            // Remount only when the lead's status changes. Remounting on every save would wipe
            // the "saved" message the moment the refreshed page arrives.
            key={lead.status}
            leadId={id}
            definition={requirements.definition}
            initialAnswers={requirements.answers}
            initialStatus={requirements.status}
            saved={requirements.saved}
            canEdit={canWrite && !closed}
          />
        </CardContent>
      </Card>

      {advisorVisible ? (
        <Card>
          <CardHeader>
            <CardTitle>{tAdvisor("title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{tAdvisor("subtitle")}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {canWrite && !closed ? (
              requirements.saved ? (
                <AdvisorRunner leadId={id} />
              ) : (
                <Alert>{tAdvisor("needRequirements")}</Alert>
              )
            ) : null}

            {runs.length > 1 ? (
              <nav
                aria-label={tAdvisor("history")}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-medium">{tAdvisor("history")}:</span>
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/leads/${id}?rec=${run.id}`}
                    aria-current={run.id === selectedId ? "true" : undefined}
                    className={
                      run.id === selectedId
                        ? "font-bold text-primary"
                        : "text-primary hover:underline"
                    }
                  >
                    {dt(run.createdAt)}
                  </Link>
                ))}
              </nav>
            ) : null}

            {selected ? (
              <div className="flex flex-col gap-6">
                <AdvisorResults view={selected} />
                {canRunTool(session.actor.role, "explain_recommendation") ? (
                  <AiAssist
                    key={selected.id}
                    tool="explain_recommendation"
                    input={{ recommendationId: selected.id }}
                    label={tAi("explainRecommendation")}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{tAdvisor("noRuns")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {leadQuotes ? (
        <Card>
          <CardHeader>
            <CardTitle>{tq("title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {leadQuotes.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tq("emptyForLead")}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {leadQuotes.items.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/quotes/${q.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      <span dir="ltr">{q.number}</span> — {q.title}
                    </Link>
                    <QuoteStatusBadge status={q.status} />
                  </li>
                ))}
              </ul>
            )}
            {can(session.actor.role, "quote:write") && !closed ? (
              <CreateQuote leadId={id} defaultTitle={lead.title} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
