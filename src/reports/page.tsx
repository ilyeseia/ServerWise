import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { Table, Td, Th } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function ReportsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  // Generate some sample data for now - in production this would come from API
  const mockRows = [
    { id: "1", date: "2024-01-15", customer: "شركةexample", service: "صيانة سنوية", amount: "5,000", status: "مكتمل" },
    { id: "2", date: "2024-02-20", customer: "مؤسسةexample", service: "إعداد خادم", amount: "12,500", status: "معلقة" },
    { id: "3", date: "2024-03-10", customer: "شركةexample", service: "إعداد شبكة", amount: "8,200", status: "مكتمل" },
  ];

  const t = await getTranslations("Reports");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {mockRows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table caption={t("table")}>
          <thead>
            <tr>
              <Th>{t("date")}</Th>
              <Th>{t("customer")}</Th>
              <Th>{t("service")}</Th>
              <Th>{t("amount")}</Th>
              <Th>{t("status")}</Th>
            </tr>
          </thead>
          <tbody>
            {mockRows.map((row) => (
              <tr key={row.id}>
                <Td className="whitespace-nowrap" dir="ltr">
                  <time dateTime={row.date}>
                    {new Date(row.date).toLocaleDateString("ar-SA")}
                  </time>
                </Td>
                <Td dir="ltr">{row.customer}</Td>
                <Td>{row.service}</Td>
                <Td dir="ltr">{row.amount}</Td>
                <Td>
                  <span className={row.status === "مكتمل" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                    {row.status}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}