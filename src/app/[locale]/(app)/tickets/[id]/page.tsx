import { getTranslations, setRequestLocale } from "next-intl/server";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/care/badges";
import { TicketControls } from "@/components/care/ticket-controls";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getTicket, listTicketStaff } from "@/modules/careops/tickets";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function TicketPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("ticket:read");
  const ctx = await actionContext();
  const role = session.actor.role;

  const [ticket, staff, t, format] = await Promise.all([
    orNotFound(getTicket(ctx, id)),
    listTicketStaff(ctx),
    getTranslations("Tickets"),
    getAppFormatter(),
  ]);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/tickets" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">
          <span dir="ltr">{ticket.number}</span> — {ticket.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
          <Link href={`/customers/${ticket.customer.id}`} className="hover:underline">
            {ticket.customer.name}
          </Link>
          {ticket.asset ? (
            <Link href={`/assets/${ticket.asset.id}`} className="text-primary hover:underline">
              {ticket.asset.name}
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            {t("assignee")}: {ticket.assignee?.name ?? t("unassigned")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("openedOn", { date: when(ticket.createdAt) })}
          {ticket.resolvedAt ? ` · ${t("resolvedOn", { date: when(ticket.resolvedAt) })}` : ""}
          {ticket.closedAt ? ` · ${t("closedOn", { date: when(ticket.closedAt) })}` : ""}
        </p>
      </header>

      {ticket.status === "closed" ? <Alert>{t("closedNotice")}</Alert> : null}
      {ticket.description ? (
        <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
      ) : null}
      {ticket.resolution && (ticket.status === "resolved" || ticket.status === "closed") ? (
        <Alert variant="success">
          <strong>{t("resolution")}:</strong> {ticket.resolution}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("discussion")}</CardTitle>
        </CardHeader>
        <CardContent>
          {ticket.comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noComments")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {ticket.comments.map((c) => (
                <li key={c.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="mb-1 text-xs text-muted-foreground">
                    {c.authorName ?? t("unknownAuthor")} · {when(c.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {ticket.serviceReports.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("visits")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {ticket.serviceReports.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="mb-1 text-xs text-muted-foreground">{when(r.performedAt)}</p>
                  <p className="whitespace-pre-wrap">{r.summary}</p>
                  {r.partsReplaced ? (
                    <p className="mt-1 text-xs text-muted-foreground">{r.partsReplaced}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {can(role, "ticket:write") || can(role, "maintenance:perform") ? (
        <Card>
          <CardContent className="pt-6">
            <TicketControls
              // Reset the forms after a server-side change.
              key={`${ticket.status}-${ticket.comments.length}-${ticket.serviceReports.length}`}
              ticketId={ticket.id}
              status={ticket.status}
              nextStatuses={[...ticket.nextStatuses]}
              resolution={ticket.resolution ?? ""}
              title={ticket.title}
              description={ticket.description ?? ""}
              priority={ticket.priority}
              assigneeId={ticket.assigneeId ?? ""}
              staff={staff}
              canWrite={can(role, "ticket:write")}
              canPerform={can(role, "maintenance:perform")}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
