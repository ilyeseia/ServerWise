import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Table, Td, Th } from "@/components/ui/table";
import { resolveLocale } from "@/i18n/locale";
import { AUDIT_ACTIONS, auditMessageKey, listAudit, type AuditAction } from "@/server/audit";
import { requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AuditPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const session = await requirePagePermission("audit:read");

  const [t, format, rows] = await Promise.all([
    getTranslations("Audit"),
    getFormatter(),
    listAudit(session.actor, { limit: 200 }),
  ]);
  // Message keys cannot contain dots (next-intl nests on them): "auth.login.success" -> "auth_login_success".
  const labelFor = (action: string) =>
    (AUDIT_ACTIONS as readonly string[]).includes(action)
      ? t(`actions.${auditMessageKey(action as AuditAction)}`)
      : action;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table caption={t("table")}>
          <thead>
            <tr>
              <Th>{t("time")}</Th>
              <Th>{t("action")}</Th>
              <Th>{t("actor")}</Th>
              <Th>{t("entity")}</Th>
              <Th>{t("ip")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td className="whitespace-nowrap" dir="ltr">
                  <time dateTime={row.createdAt.toISOString()}>
                    {format.dateTime(row.createdAt, { dateStyle: "short", timeStyle: "medium" })}
                  </time>
                </Td>
                <Td>{labelFor(row.action)}</Td>
                <Td dir="ltr">{row.actorEmail ?? "—"}</Td>
                <Td dir="ltr">
                  {row.entityType ? `${row.entityType}:${row.entityId ?? ""}` : "—"}
                </Td>
                <Td dir="ltr">{row.ip ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
