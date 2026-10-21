import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  BackupStatusBadge,
  HealthBadge,
  RestoreStatusBadge,
} from "@/components/backups/badges";
import { Pagination } from "@/components/crm/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listPolicies } from "@/modules/backups/service";
import type { Health } from "@/modules/backups/rules";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

const HEALTHS: Health[] = ["critical", "warning", "ok", "inactive"];

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ health?: string; customerId?: string; page?: string }>;
};

export default async function BackupsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("backup:read");
  const sp = await searchParams;
  const health = HEALTHS.find((h) => h === sp.health);

  const [t, tHealth, tKind, tCrm, format] = await Promise.all([
    getTranslations("Backups"),
    getTranslations("Backups.health"),
    getTranslations("Backups.kind"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listPolicies(await actionContext(), {
    health,
    customerId: sp.customerId,
    page: Number(sp.page) || 1,
  });
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : t("never"));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {can(session.actor.role, "backup:write") ? (
          <Link
            href={sp.customerId ? `/backups/new?customerId=${sp.customerId}` : "/backups/new"}
            className={buttonVariants()}
          >
            {t("newPolicy")}
          </Link>
        ) : null}
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        {sp.customerId ? <input type="hidden" name="customerId" value={sp.customerId} /> : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="health" className="text-sm font-medium">
            {t("healthLabel")}
          </label>
          <Select id="health" name="health" defaultValue={health ?? ""}>
            <option value="">{t("all")}</option>
            {HEALTHS.map((h) => (
              <option key={h} value={h}>
                {tHealth(h)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">{tCrm("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{health ? t("noMatches") : t("empty")}</p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("name")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("kindLabel")}</Th>
                <Th>{t("healthLabel")}</Th>
                <Th>{t("backupLabel")}</Th>
                <Th>{t("restoreLabel")}</Th>
                <Th>{t("lastSuccess")}</Th>
                <Th>{t("lastRestore")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/backups/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.name}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${p.customerId}`} className="hover:underline">
                      {p.customerName}
                    </Link>
                  </Td>
                  <Td>{tKind(p.kind as "files")}</Td>
                  <Td>
                    <HealthBadge health={p.health} />
                  </Td>
                  <Td>
                    <BackupStatusBadge status={p.backup} />
                  </Td>
                  <Td>
                    <RestoreStatusBadge status={p.restore} />
                  </Td>
                  <Td>{date(p.lastSuccessAt)}</Td>
                  <Td>{date(p.lastRestoreSuccessAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/backups"
            params={{ health: sp.health, customerId: sp.customerId }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
