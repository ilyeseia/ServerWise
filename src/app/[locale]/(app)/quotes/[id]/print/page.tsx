import { getTranslations, setRequestLocale } from "next-intl/server";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatLocaleTag } from "@/i18n/routing";
import { formatMoney } from "@/modules/quotes/format";
import { getIssuedSnapshot, getQuote } from "@/modules/quotes/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ rev?: string }>;
};

/** The shape stored by issueRevision(); the customer's copy never shows costs or sources. */
interface Snapshot {
  number: string;
  revision: number;
  title: string;
  issuedAt: string;
  validUntil: string;
  notes: string | null;
  company: { name: string; phone: string; address: string };
  customer: { name: string; legalName: string | null; phone: string | null; email: string | null };
  lines: {
    position: number;
    kind: "hardware" | "labor" | "service" | "other";
    description: string;
    quantity: string;
    unitPrice: string;
    discountPct: string;
    taxRatePct: string;
    calc: { net: string; tax: string; total: string };
  }[];
  totals: { subtotal: string; discount: string; tax: string; total: string };
}

/**
 * A clean, print-friendly page built from the frozen snapshot. Use the browser's "Save as PDF":
 * the browser shapes Arabic correctly (joined letters, right-to-left), which is the reason this
 * stage prints from HTML instead of drawing a PDF by hand.
 */
export default async function QuotePrintPage({ params, searchParams }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  await requirePagePermission("quote:read");
  const ctx = await actionContext();
  const { rev } = await searchParams;

  const quote = await orNotFound(getQuote(ctx, id));
  const revision = quote.revisions.find((r) => String(r.number) === rev) ?? quote.revisions[0]!;
  const issued = await orNotFound(getIssuedSnapshot(ctx, revision.id));
  const snap = issued.snapshot as unknown as Snapshot;

  const [t, tKind, format] = await Promise.all([
    getTranslations("Quotes"),
    getTranslations("Quotes.kind"),
    getAppFormatter(),
  ]);
  const money = (value: string) => formatMoney(value, formatLocaleTag[locale]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 bg-card p-2 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/quotes/${id}?rev=${revision.number}`}
          className="text-sm text-primary hover:underline"
        >
          ← {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{snap.company.name || t("companyMissing")}</h1>
          {snap.company.address ? <p className="text-sm">{snap.company.address}</p> : null}
          {snap.company.phone ? (
            <p className="text-sm" dir="ltr">
              {snap.company.phone}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-lg font-bold">{t("quotation")}</p>
          <p dir="ltr">
            {snap.number} / {t("revisionShort", { n: snap.revision })}
          </p>
          <p>{t("issuedOn", { date: date(snap.issuedAt) })}</p>
          <p>{t("validUntil", { date: date(snap.validUntil) })}</p>
        </div>
      </header>

      <section className="flex flex-col gap-1 text-sm">
        <h2 className="font-semibold">{t("preparedFor")}</h2>
        <p>{snap.customer.legalName || snap.customer.name}</p>
        {snap.customer.phone ? <p dir="ltr">{snap.customer.phone}</p> : null}
        {snap.customer.email ? <p dir="ltr">{snap.customer.email}</p> : null}
        <p className="mt-2 font-medium">{snap.title}</p>
      </section>

      <Table caption={t("linesTable")}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>{t("col.description")}</Th>
            <Th>{t("col.quantity")}</Th>
            <Th>{t("col.unitPrice")}</Th>
            <Th>{t("col.discount")}</Th>
            <Th>{t("col.tax")}</Th>
            <Th>{t("col.total")}</Th>
          </tr>
        </thead>
        <tbody>
          {snap.lines.map((line) => (
            <tr key={line.position}>
              <Td>{line.position}</Td>
              <Td>
                {line.description}
                <span className="ms-2 text-xs text-muted-foreground">({tKind(line.kind)})</span>
              </Td>
              <Td dir="ltr">{Number(line.quantity)}</Td>
              <Td dir="ltr">{money(line.unitPrice)}</Td>
              <Td dir="ltr">{Number(line.discountPct)}%</Td>
              <Td dir="ltr">{Number(line.taxRatePct)}%</Td>
              <Td dir="ltr" className="whitespace-nowrap">
                {money(line.calc.total)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <dl className="ms-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt>{t("subtotal")}</dt>
        <dd dir="ltr">{money(snap.totals.subtotal)}</dd>
        <dt>{t("tax")}</dt>
        <dd dir="ltr">{money(snap.totals.tax)}</dd>
        <dt className="text-base font-bold">{t("total")}</dt>
        <dd dir="ltr" className="text-base font-bold">
          {money(snap.totals.total)} {t("currency")}
        </dd>
      </dl>

      {snap.notes ? (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold">{t("notes")}</h2>
          <p className="whitespace-pre-wrap">{snap.notes}</p>
        </section>
      ) : null}
    </article>
  );
}
