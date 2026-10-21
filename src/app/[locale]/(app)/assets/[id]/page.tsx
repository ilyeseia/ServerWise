import { getTranslations, setRequestLocale } from "next-intl/server";
import { RenewalBadge, TicketPriorityBadge, TicketStatusBadge } from "@/components/care/badges";
import { Badge } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getAsset } from "@/modules/careops/assets";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function AssetPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("asset:read");
  const asset = await orNotFound(getAsset(await actionContext(), id));

  const [t, tKind, tStatus, format] = await Promise.all([
    getTranslations("Assets"),
    getTranslations("Assets.kind"),
    getTranslations("Assets.status"),
    getAppFormatter(),
  ]);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : t("unknown"));

  const rows: [string, React.ReactNode][] = [
    [t("kindLabel"), tKind(asset.kind)],
    [t("brand"), asset.brand ?? t("unknown")],
    [t("model"), asset.model ?? t("unknown")],
    [
      t("serial"),
      <span key="s" dir="ltr">
        {asset.serialNumber ?? t("unknown")}
      </span>,
    ],
    [t("os"), asset.os ?? t("unknown")],
    [
      t("version"),
      <span key="v" dir="ltr">
        {asset.version ?? t("unknown")}
      </span>,
    ],
    [t("location"), asset.location ?? t("unknown")],
    [t("installedAt"), date(asset.installedAt)],
    [
      t("warrantyUntil"),
      <span key="w" className="flex flex-wrap items-center gap-2">
        {date(asset.warrantyUntil)} <RenewalBadge state={asset.warranty} />
      </span>,
    ],
    [
      t("renewsAt"),
      <span key="r" className="flex flex-wrap items-center gap-2">
        {date(asset.renewsAt)} <RenewalBadge state={asset.renewal} />
      </span>,
    ],
    [t("credentialsRef"), asset.credentialsRef ?? t("unknown")],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/assets" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{asset.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={asset.status === "faulty" ? "danger" : "neutral"}>
              {tStatus(asset.status)}
            </Badge>
            <Link href={`/customers/${asset.customer.id}`} className="hover:underline">
              {asset.customer.name}
            </Link>
            {asset.project ? (
              <Link href={`/projects/${asset.project.id}`} className="text-primary hover:underline">
                {asset.project.number}
              </Link>
            ) : null}
          </div>
        </div>
        {can(session.actor.role, "asset:write") ? (
          <Link
            href={`/assets/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("edit")}
          </Link>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          {asset.notes ? <p className="mt-4 text-sm whitespace-pre-wrap">{asset.notes}</p> : null}
        </CardContent>
      </Card>

      {asset.contracts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("coveredBy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {asset.contracts.map(({ contract }) => (
                <li key={contract.id}>
                  <Link
                    href={`/maintenance/${contract.id}`}
                    className="text-primary hover:underline"
                  >
                    {contract.title}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("tickets")}</CardTitle>
        </CardHeader>
        <CardContent>
          {asset.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTickets")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {asset.tickets.map((ticket) => (
                <li key={ticket.id} className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    <span dir="ltr">{ticket.number}</span> — {ticket.title}
                  </Link>
                  <TicketStatusBadge status={ticket.status} />
                  <TicketPriorityBadge priority={ticket.priority} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
