import { getTranslations, setRequestLocale } from "next-intl/server";
import { QuoteStatusBadge } from "@/components/quotes/status-badge";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatLocaleTag } from "@/i18n/routing";
import { listProducts } from "@/modules/catalog/products";
import { formatMoney } from "@/modules/quotes/format";
import { readPricing } from "@/modules/quotes/pricing";
import { findProjectForQuote } from "@/modules/projects/service";
import { getQuote } from "@/modules/quotes/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { CreateProject } from "./create-project";
import { QuoteEditor, type EditorLine } from "./quote-editor";
import { RevisionControls } from "./revision-controls";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ rev?: string }>;
};

export default async function QuotePage({ params, searchParams }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const session = await requirePagePermission("quote:read");
  const ctx = await actionContext();
  const role = session.actor.role;

  const quote = await orNotFound(getQuote(ctx, id));
  const { rev } = await searchParams;
  const selected = quote.revisions.find((r) => String(r.number) === rev) ?? quote.revisions[0]!;
  const latest = quote.revisions[0]!;

  const tp = await getTranslations("Projects");
  const [t, tKind, format] = await Promise.all([
    getTranslations("Quotes"),
    getTranslations("Quotes.kind"),
    getAppFormatter(),
  ]);
  const tag = formatLocaleTag[locale];
  const money = (value: string) => formatMoney(value, tag);
  const canWrite = can(role, "quote:write");
  const showCost = canWrite;

  const isDraft = selected.storedStatus === "draft";
  const editable = isDraft && canWrite;
  const pricing = editable ? await readPricing() : null;
  const products = editable
    ? (await listProducts(ctx, { pageSize: 100 })).items.map((p) => ({
        id: p.id,
        label: `${p.brand} ${p.model}`,
      }))
    : [];

  const acceptedRevision = quote.revisions.find((r) => r.storedStatus === "accepted");
  const project =
    acceptedRevision && can(role, "project:read") ? await findProjectForQuote(ctx, id) : null;

  const isLatest = selected.id === latest.id;
  const canDecide =
    can(role, "quote:decide") &&
    isLatest &&
    selected.storedStatus === "issued" &&
    selected.status !== "expired";
  const canRevise =
    canWrite &&
    isLatest &&
    (selected.status === "expired" ||
      selected.storedStatus === "rejected" ||
      selected.storedStatus === "issued") &&
    !quote.revisions.some((r) => r.storedStatus === "accepted") &&
    quote.lead.status !== "won" &&
    quote.lead.status !== "lost";

  const editorLines: EditorLine[] = selected.lines.map((line) => ({
    kind: line.kind,
    description: line.description,
    quantity: String(Number(line.quantity)),
    unitPrice: line.unitPrice,
    discountPct: String(Number(line.discountPct)),
    taxRatePct: String(Number(line.taxRatePct)),
    unitCost: line.unitCost,
    productId: line.productId,
    offerId: line.offerId,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/leads/${quote.lead.id}`} className="text-sm text-primary hover:underline">
        ← {quote.lead.title}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">
            <span dir="ltr">{quote.number}</span> — {quote.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <QuoteStatusBadge status={selected.status} />
            <span className="text-muted-foreground">{quote.lead.customer.name}</span>
            <span className="text-muted-foreground">
              {t("revisionLabel", { n: selected.number })}
            </span>
          </div>
          {selected.validUntil ? (
            <p className="text-xs text-muted-foreground">
              {t("validUntil", {
                date: format.dateTime(selected.validUntil, { dateStyle: "medium" }),
              })}
            </p>
          ) : null}
        </div>
        {!isDraft ? (
          <Link
            href={`/quotes/${id}/print?rev=${selected.number}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("printView")}
          </Link>
        ) : null}
      </header>

      {quote.revisions.length > 1 ? (
        <nav aria-label={t("revisions")} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("revisions")}:</span>
          {quote.revisions.map((r) => (
            <Link
              key={r.id}
              href={`/quotes/${id}?rev=${r.number}`}
              aria-current={r.id === selected.id ? "true" : undefined}
              className={
                r.id === selected.id ? "font-bold text-primary" : "text-primary hover:underline"
              }
            >
              {t("revisionShort", { n: r.number })} ({t(`status.${r.status}`)})
            </Link>
          ))}
        </nav>
      ) : null}

      {isDraft && !canWrite ? <Alert>{t("draftReadOnly")}</Alert> : null}
      {selected.status === "expired" ? <Alert>{t("expiredNotice")}</Alert> : null}
      {selected.decidedAt ? (
        <Alert variant={selected.storedStatus === "accepted" ? "success" : "info"}>
          {t(selected.storedStatus === "accepted" ? "acceptedOn" : "rejectedOn", {
            date: format.dateTime(selected.decidedAt, { dateStyle: "medium" }),
          })}
          {selected.decisionNote ? ` — ${selected.decisionNote}` : ""}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("lines")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && pricing ? (
            <QuoteEditor
              // A new key remounts the editor when the saved revision changes.
              key={`${selected.id}-${selected.calculation.total}-${selected.lines.length}`}
              revisionId={selected.id}
              initialLines={editorLines}
              initialNotes={selected.notes ?? ""}
              taxRates={["0", ...pricing.taxRatesPct.filter((r) => Number(r) !== 0)]}
              defaultTaxRate={pricing.defaultTaxRatePct ?? "0"}
              products={products}
              canIssue={can(role, "quote:issue")}
              localeTag={tag}
              laborRate={pricing.laborRateDzdPerHour}
            />
          ) : (
            <>
              {selected.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noLines")}</p>
              ) : (
                <Table caption={t("linesTable")}>
                  <thead>
                    <tr>
                      <Th>{t("col.kind")}</Th>
                      <Th>{t("col.description")}</Th>
                      <Th>{t("col.quantity")}</Th>
                      <Th>{t("col.unitPrice")}</Th>
                      <Th>{t("col.discount")}</Th>
                      <Th>{t("col.tax")}</Th>
                      <Th>{t("col.total")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line, index) => (
                      <tr key={line.id}>
                        <Td>{tKind(line.kind)}</Td>
                        <Td>{line.description}</Td>
                        <Td dir="ltr">{Number(line.quantity)}</Td>
                        <Td dir="ltr">{money(line.unitPrice)}</Td>
                        <Td dir="ltr">{Number(line.discountPct)}%</Td>
                        <Td dir="ltr">{Number(line.taxRatePct)}%</Td>
                        <Td dir="ltr" className="whitespace-nowrap">
                          {money(selected.calculation.lines[index]!.total)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {selected.notes ? (
                <p className="text-sm whitespace-pre-wrap">{selected.notes}</p>
              ) : null}
              <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                <dt>{t("subtotal")}</dt>
                <dd dir="ltr">{money(selected.subtotalDzd)}</dd>
                <dt>{t("tax")}</dt>
                <dd dir="ltr">{money(selected.taxDzd)}</dd>
                <dt className="font-bold">{t("total")}</dt>
                <dd dir="ltr" className="font-bold">
                  {money(selected.totalDzd)} {t("currency")}
                </dd>
                {showCost ? (
                  <>
                    <dt className="text-muted-foreground">{t("margin")}</dt>
                    <dd dir="ltr" className="text-muted-foreground">
                      {selected.calculation.margin
                        ? `${money(selected.calculation.margin.amount)} (${selected.calculation.margin.pct ?? "—"}%)`
                        : t("marginUnknown")}
                    </dd>
                  </>
                ) : null}
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      {acceptedRevision && (project || can(role, "project:manage")) ? (
        <Card>
          <CardHeader>
            <CardTitle>{tp("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {project ? (
              <Link href={`/projects/${project.id}`} className="text-primary hover:underline">
                {tp("openProject", { number: project.number })}
              </Link>
            ) : (
              <CreateProject quoteId={id} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isDraft && (canDecide || canRevise) ? (
        <Card>
          <CardContent className="pt-6">
            <RevisionControls
              quoteId={id}
              revisionId={selected.id}
              canDecide={canDecide}
              canRevise={canRevise}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
