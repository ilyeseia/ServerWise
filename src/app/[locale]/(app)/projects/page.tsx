import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pagination } from "@/components/crm/pagination";
import { ProjectStatusBadge } from "@/components/projects/badges";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { PROJECT_STATUSES } from "@/modules/projects/rules";
import { listProjects } from "@/modules/projects/service";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
};

export default async function ProjectsPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  await requirePagePermission("project:read");
  const sp = await searchParams;
  const status = PROJECT_STATUSES.find((s) => s === sp.status);

  const [t, tStatus, tCrm, format] = await Promise.all([
    getTranslations("Projects"),
    getTranslations("Projects.status"),
    getTranslations("Crm.common"),
    getAppFormatter(),
  ]);
  const result = await listProjects(await actionContext(), {
    status,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            {t("col.status")}
          </label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">{t("all")}</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">{tCrm("search")}</Button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{status ? t("noMatches") : t("empty")}</p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("col.number")}</Th>
                <Th>{t("col.title")}</Th>
                <Th>{t("col.customer")}</Th>
                <Th>{t("col.status")}</Th>
                <Th>{t("col.progress")}</Th>
                <Th>{t("col.target")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id}>
                  <Td dir="ltr" className="whitespace-nowrap">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.number}
                    </Link>
                  </Td>
                  <Td>{p.title}</Td>
                  <Td>
                    <Link href={`/customers/${p.customerId}`} className="hover:underline">
                      {p.customerName}
                    </Link>
                  </Td>
                  <Td>
                    <ProjectStatusBadge status={p.status} />
                  </Td>
                  <Td dir="ltr" className="whitespace-nowrap">
                    {format.number(p.tasksDone)} / {format.number(p.tasksTotal)}
                  </Td>
                  <Td>
                    {p.targetDate
                      ? format.dateTime(p.targetDate, { dateStyle: "medium" })
                      : t("notSet")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/projects"
            params={{ status: sp.status }}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
