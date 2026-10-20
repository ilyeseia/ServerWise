import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pagination } from "@/components/crm/pagination";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatLocaleTag } from "@/i18n/routing";
import { formatMoney } from "@/modules/quotes/format";
import { listQuotes } from "@/modules/quotes/service";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function QuotesPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  await requirePagePermission("quote:read");
  const sp = await searchParams;

  const [t, format] = await Promise.all([getTranslations("Quotes"), getAppFormatter()]);
  const result = await listQuotes(await actionContext(), { page: Number(sp.page) || 1 });
  const tag = formatLocaleTag[locale];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <Table caption={t("listTable")}>
            <thead>
              <tr>
                <Th>{t("col.number")}</Th>
                <Th>{t("quoteTitle")}</Th>
                <Th>{t("col.customer")}</Th>
                <Th>{t("col.status")}</Th>
                <Th>{t("col.total")}</Th>
                <Th>{t("col.validUntil")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((q) => (
                <tr key={q.id}>
                  <Td dir="ltr" className="whitespace-nowrap">
                    <Link
                      href={`/quotes/${q.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {q.number}
                    </Link>
                    <span className="ms-1 text-xs text-muted-foreground">
                      {t("revisionShort", { n: q.revisionNumber })}
                    </span>
                  </Td>
                  <Td>{q.title}</Td>
                  <Td>
                    <Link href={`/customers/${q.customerId}`} className="hover:underline">
                      {q.customerName}
                    </Link>
                  </Td>
                  <Td>
                    <QuoteStatusBadge status={q.status} />
                  </Td>
                  <Td dir="ltr" className="whitespace-nowrap">
                    {formatMoney(q.totalDzd, tag)} {t("currency")}
                  </Td>
                  <Td>
                    {q.validUntil
                      ? format.dateTime(q.validUntil, { dateStyle: "medium" })
                      : t("notIssued")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            pathname="/quotes"
            params={{}}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
