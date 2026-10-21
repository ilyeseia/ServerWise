import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanStatusBadge } from "@/components/backups/badges";
import { Pagination } from "@/components/crm/pagination";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { listPlans } from "@/modules/backups/service";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customerId?: string; page?: string }>;
};

export default async function RemotePlansPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const session = await requirePagePermission("remote:read");
  const sp = await searchParams;
  const [t, tOwner, format] = await Promise.all([
    getTranslations("Remote"),
    getTranslations("Remote.owner"),
    getAppFormatter(),
  ]);
  const result = await listPlans(await actionContext(), {
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
        {can(session.actor.role, "remote:write") ? (
          <Link
            href={sp.customerId ? `/remote/new?customerId=${sp.customerId}` : "/remote/new"}
            className={buttonVariants()}
          >
            {t("newPlan")}
          </Link>
        ) : null}
      </header>
      <Alert>{t("documentationOnly")}</Alert>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("titleLabel")}</Th>
                <Th>{t("customer")}</Th>
                <Th>{t("statusLabel")}</Th>
                <Th>{t("tailnetOwner")}</Th>
                <Th>{t("gapsLabel")}</Th>
                <Th>{t("createdAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link
                      href={`/remote/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.title}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${p.customerId}`} className="hover:underline">
                      {p.customerName}
                    </Link>
                  </Td>
                  <Td>
                    <PlanStatusBadge status={p.status} />
                  </Td>
                  <Td>{tOwner(p.tailnetOwner as "customer")}</Td>
                  <Td dir="ltr">{format.number(p.gaps)}</Td>
                  <Td>{format.dateTime(p.createdAt, { dateStyle: "medium" })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/remote"
            params={{ customerId: sp.customerId }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
