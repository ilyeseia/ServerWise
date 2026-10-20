import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { ArchiveControls } from "@/components/crm/archive-controls";
import { CustomerStatusBadge, LeadStatusBadge } from "@/components/crm/badges";
import { CommunicationsPanel } from "@/components/crm/communications-panel";
import { ContactsPanel } from "@/components/crm/contacts-panel";
import { FollowUpsPanel } from "@/components/crm/followups-panel";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listCommunications } from "@/modules/crm/communications";
import { getCustomer } from "@/modules/crm/customers";
import { listFollowUps } from "@/modules/crm/followups";
import { listAssignableUsers } from "@/modules/crm/leads";
import { wilayaName } from "@/modules/crm/wilayas";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function CustomerPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const session = await requirePagePermission("crm:read");
  const role = session.actor.role;
  const ctx = await actionContext();

  const customer = await orNotFound(getCustomer(ctx, id));
  const [t, tType, tLang, tSource, format, followUps, communications, assignees] =
    await Promise.all([
      getTranslations("Crm.customer"),
      getTranslations("Crm.type"),
      getTranslations("Crm.language"),
      getTranslations("Crm.leadSource"),
      getAppFormatter(),
      listFollowUps(ctx, { customerId: id, status: "open", pageSize: 50 }),
      listCommunications(ctx, { customerId: id }, 50),
      listAssignableUsers(ctx),
    ]);
  const tl = await getTranslations("Crm.leads");
  const tc = await getTranslations("Crm.customers");
  const tf = await getTranslations("Crm.customerForm");

  const archived = customer.status === "archived";
  const canWrite = can(role, "crm:write") && !archived;
  const dt = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/customers" className="text-sm text-primary hover:underline">
        ← {t("back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CustomerStatusBadge status={customer.status} />
            <span className="text-muted-foreground">{tType(customer.type)}</span>
            <span className="text-muted-foreground">
              ·{" "}
              {t("createdOn", {
                date: format.dateTime(customer.createdAt, { dateStyle: "medium" }),
              })}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canWrite ? (
            <Link
              href={`/customers/${id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {(await getTranslations("Crm.common"))("edit")}
            </Link>
          ) : null}
          {can(role, "crm:archive") ? (
            <ArchiveControls customerId={id} archived={archived} />
          ) : null}
        </div>
      </header>

      {archived ? <Alert>{t("archivedNotice")}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Info label={tc("phone")} value={customer.phone} ltr />
            <Info label={tc("email")} value={customer.email} ltr />
            <Info label={tc("wilaya")} value={wilayaName(customer.wilayaCode, locale)} />
            <Info label={tf("language")} value={tLang(customer.preferredLanguage)} />
            {customer.type === "business" ? (
              <>
                <Info label={tf("legalName")} value={customer.legalName} />
                <Info label={tf("taxId")} value={customer.taxId} ltr />
              </>
            ) : null}
            <Info label={tf("address")} value={customer.address} />
            <Info label={tf("notes")} value={customer.notes} wide />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("contacts")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ContactsPanel
            customerId={id}
            canWrite={canWrite}
            contacts={customer.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              jobTitle: c.jobTitle,
              phone: c.phone,
              email: c.email,
              isPrimary: c.isPrimary,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t("leads")}</CardTitle>
            {canWrite ? (
              <Link
                href={`/leads/new?customerId=${id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {tl("add")}
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {customer.leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noLeads")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {customer.leads.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                >
                  <Link
                    href={`/leads/${l.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {l.title}
                  </Link>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{tSource(l.source)}</span>
                    <LeadStatusBadge status={l.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("followUps")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FollowUpsPanel
            canWrite={canWrite}
            create={{
              customerId: id,
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
          <CardTitle>{t("communications")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CommunicationsPanel
            customerId={id}
            canWrite={canWrite}
            leadOptions={customer.leads.map((l) => ({ id: l.id, title: l.title }))}
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

function Info({
  label,
  value,
  ltr,
  wide,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className="whitespace-pre-wrap">
        {value || "—"}
      </dd>
    </div>
  );
}
