import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { FollowUpsPanel } from "@/components/crm/followups-panel";
import { Pagination } from "@/components/crm/pagination";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { resolveLocale } from "@/i18n/locale";
import { listFollowUps } from "@/modules/crm/followups";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string; status?: string; overdue?: string; page?: string }>;
};

const STATUSES = ["open", "done", "cancelled"] as const;

export default async function FollowUpsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("crm:read");
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const status = STATUSES.find((s) => s === sp.status) ?? "open";
  const overdueOnly = sp.overdue === "1";

  const [t, tCommon, format] = await Promise.all([
    getTranslations("Crm.followUps"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listFollowUps(await actionContext(), {
    scope,
    status,
    overdueOnly,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scope" className="text-sm font-medium">
            {t("assignedTo")}
          </label>
          <Select id="scope" name="scope" defaultValue={scope}>
            <option value="mine">{t("mine")}</option>
            <option value="all">{t("everyone")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("status")}
          </label>
          <Select id="status" name="status" defaultValue={status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} />
          {t("onlyOverdue")}
        </label>
        <Button type="submit">{tCommon("search")}</Button>
      </form>

      <FollowUpsPanel
        showCustomer
        canWrite={can(session.actor.role, "crm:write")}
        items={result.items.map((f) => ({
          id: f.id,
          title: f.title,
          dueLabel: format.dateTime(f.dueAt, { dateStyle: "medium", timeStyle: "short" }),
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

      {result.total > result.pageSize ? (
        <Pagination
          pathname="/follow-ups"
          params={{ scope: sp.scope, status: sp.status, overdue: sp.overdue }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
        />
      ) : null}
    </div>
  );
}
