import { getTranslations, setRequestLocale } from "next-intl/server";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/care/badges";
import { Pagination } from "@/components/crm/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/modules/careops/rules";
import { listTickets } from "@/modules/careops/tickets";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    priority?: string;
    open?: string;
    customerId?: string;
    page?: string;
  }>;
};

export default async function TicketsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("ticket:read");
  const sp = await searchParams;
  const status = TICKET_STATUSES.find((s) => s === sp.status);
  const priority = TICKET_PRIORITIES.find((p) => p === sp.priority);
  const openOnly = sp.open === "1";

  const [t, tStatus, tPriority, tCrm, format] = await Promise.all([
    getTranslations("Tickets"),
    getTranslations("Tickets.status"),
    getTranslations("Tickets.priority"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listTickets(await actionContext(), {
    q: sp.q,
    status,
    priority,
    openOnly,
    customerId: sp.customerId,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "ticket:write") ? (
          <Link
            href={sp.customerId ? `/tickets/new?customerId=${sp.customerId}` : "/tickets/new"}
            className={buttonVariants()}
          >
            {t("open")}
          </Link>
        ) : null}
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        {sp.customerId ? <input type="hidden" name="customerId" value={sp.customerId} /> : null}
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            {t("search")}
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("statusLabel")}
          </label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">{t("all")}</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="priority" className="text-sm font-medium">
            {t("priorityLabel")}
          </label>
          <Select id="priority" name="priority" defaultValue={priority ?? ""}>
            <option value="">{t("all")}</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {tPriority(p)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="open" value="1" defaultChecked={openOnly} />
          {t("openOnly")}
        </label>
        <Button type="submit">{tCrm("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">
          {sp.q || status || priority || openOnly ? t("noMatches") : t("empty")}
        </p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("number")}</Th>
                <Th>{t("titleLabel")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("statusLabel")}</Th>
                <Th>{t("priorityLabel")}</Th>
                <Th>{t("assignee")}</Th>
                <Th>{t("openedAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((ticket) => (
                <tr key={ticket.id}>
                  <Td dir="ltr" className="whitespace-nowrap">
                    <Link
                      href={`/tickets/${ticket.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {ticket.number}
                    </Link>
                  </Td>
                  <Td>{ticket.title}</Td>
                  <Td>
                    <Link href={`/customers/${ticket.customerId}`} className="hover:underline">
                      {ticket.customerName}
                    </Link>
                  </Td>
                  <Td>
                    <TicketStatusBadge status={ticket.status} />
                  </Td>
                  <Td>
                    <TicketPriorityBadge priority={ticket.priority} />
                  </Td>
                  <Td>{ticket.assigneeName ?? t("unassigned")}</Td>
                  <Td>{format.dateTime(ticket.createdAt, { dateStyle: "medium" })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/tickets"
            params={{
              q: sp.q,
              status: sp.status,
              priority: sp.priority,
              open: sp.open,
              customerId: sp.customerId,
            }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
