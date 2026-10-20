"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { calculateQuote, CalcError, type CalcResult } from "@/modules/quotes/calc";
import { formatMoney } from "@/modules/quotes/format";
import { LINE_KINDS } from "@/modules/quotes/schemas";
import { issueRevisionAction, saveDraftAction, suggestLineAction } from "../actions";

export interface EditorLine {
  kind: (typeof LINE_KINDS)[number];
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRatePct: string;
  /** Known only for lines tied to a verified supplier price (read-only here). */
  unitCost: string | null;
  productId: string | null;
  offerId: string | null;
}

interface Props {
  revisionId: string;
  initialLines: EditorLine[];
  initialNotes: string;
  /** Tax rates (percent strings) staff may use; always includes "0". */
  taxRates: string[];
  defaultTaxRate: string;
  products: { id: string; label: string }[];
  canIssue: boolean;
  localeTag: string;
  laborRate: string | null;
}

const blank = (taxRate: string): EditorLine => ({
  kind: "service",
  description: "",
  quantity: "1",
  unitPrice: "0",
  discountPct: "0",
  taxRatePct: taxRate,
  unitCost: null,
  productId: null,
  offerId: null,
});

/** Live totals use the same deterministic calculator as the server; the server's result is final. */
function preview(lines: EditorLine[]): { result: CalcResult | null; invalid: boolean } {
  try {
    return {
      result: calculateQuote(
        lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPct: line.discountPct,
          taxRatePct: line.taxRatePct,
          unitCost: line.unitCost,
        })),
      ),
      invalid: false,
    };
  } catch (error) {
    if (error instanceof CalcError) return { result: null, invalid: true };
    throw error;
  }
}

export function QuoteEditor(props: Props) {
  const t = useTranslations("Quotes");
  const tKind = useTranslations("Quotes.kind");
  const errorText = useErrorText();
  const router = useRouter();
  const [lines, setLines] = useState<EditorLine[]>(props.initialLines);
  const [notes, setNotes] = useState(props.initialNotes);
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const { result, invalid } = useMemo(() => preview(lines), [lines]);
  const money = (value: string) => formatMoney(value, props.localeTag);

  function update(index: number, patch: Partial<EditorLine>) {
    setSaved(false);
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function payload() {
    return {
      notes,
      lines: lines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxRatePct: line.taxRatePct,
        unitCost: line.offerId ? undefined : (line.unitCost ?? undefined),
        productId: line.productId ?? undefined,
        offerId: line.offerId ?? undefined,
      })),
    };
  }

  function save(thenIssue: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await saveDraftAction(props.revisionId, payload());
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      if (thenIssue) {
        const issued = await issueRevisionAction(props.revisionId);
        if (!issued.ok) {
          setError(errorText(issued.code));
          return;
        }
        router.refresh();
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function addProduct() {
    if (!productId) return;
    setError(null);
    startTransition(async () => {
      const result = await suggestLineAction(productId);
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setSaved(false);
      setLines((current) => [
        ...current,
        {
          ...blank(props.defaultTaxRate),
          kind: "hardware",
          description: result.description,
          unitPrice: result.suggestedUnitPrice ?? "",
          unitCost: result.costDzd,
          productId,
          offerId: result.offerId,
        },
      ]);
      setProductId("");
      if (!result.offerId) setError(t("noUsablePrice"));
    });
  }

  const hasMissingPrice = lines.some((line) => line.unitPrice === "");

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {saved ? <Alert variant="success">{t("savedDraft")}</Alert> : null}
      {invalid || hasMissingPrice ? <Alert variant="danger">{t("fixNumbers")}</Alert> : null}

      {lines.length === 0 ? (
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
              <Th>{t("col.net")}</Th>
              <Th>
                <span className="sr-only">{t("removeLine")}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const calc = result?.lines[index];
              const label = t("lineN", { n: index + 1 });
              return (
                <tr key={index}>
                  <Td>
                    <Select
                      aria-label={`${label}: ${t("col.kind")}`}
                      value={line.kind}
                      onChange={(e) =>
                        update(index, { kind: e.target.value as EditorLine["kind"] })
                      }
                    >
                      {LINE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {tKind(kind)}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td className="min-w-56">
                    <Input
                      aria-label={`${label}: ${t("col.description")}`}
                      maxLength={300}
                      value={line.description}
                      onChange={(e) => update(index, { description: e.target.value })}
                    />
                    {line.offerId ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("costFromOffer", { cost: money(line.unitCost ?? "0") })}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <Input
                      aria-label={`${label}: ${t("col.quantity")}`}
                      dir="ltr"
                      inputMode="decimal"
                      className="w-24"
                      value={line.quantity}
                      onChange={(e) => update(index, { quantity: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label={`${label}: ${t("col.unitPrice")}`}
                      dir="ltr"
                      inputMode="decimal"
                      className="w-32"
                      value={line.unitPrice}
                      onChange={(e) => update(index, { unitPrice: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label={`${label}: ${t("col.discount")}`}
                      dir="ltr"
                      inputMode="decimal"
                      className="w-20"
                      value={line.discountPct}
                      onChange={(e) => update(index, { discountPct: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Select
                      aria-label={`${label}: ${t("col.tax")}`}
                      className="w-24"
                      value={line.taxRatePct}
                      onChange={(e) => update(index, { taxRatePct: e.target.value })}
                    >
                      {props.taxRates.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}%
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td dir="ltr" className="whitespace-nowrap">
                    {calc ? money(calc.net) : "…"}
                  </Td>
                  <Td>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${t("removeLine")}: ${label}`}
                      onClick={() => {
                        setSaved(false);
                        setLines((current) => current.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSaved(false);
            setLines((current) => [...current, blank(props.defaultTaxRate)]);
          }}
        >
          {t("addLine")}
        </Button>
        {props.laborRate ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSaved(false);
              setLines((current) => [
                ...current,
                {
                  ...blank(props.defaultTaxRate),
                  kind: "labor",
                  description: t("laborDefault"),
                  unitPrice: props.laborRate ?? "0",
                },
              ]);
            }}
          >
            {t("addLabor", { rate: money(props.laborRate) })}
          </Button>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-product" className="text-sm font-medium">
              {t("addProduct")}
            </label>
            <Select
              id="add-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="min-w-56"
            >
              <option value="">{t("chooseProduct")}</option>
              {props.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!productId || pending}
            onClick={addProduct}
          >
            {t("add")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="quote-notes" className="text-sm font-medium">
          {t("notes")}
        </label>
        <Textarea
          id="quote-notes"
          maxLength={2000}
          value={notes}
          onChange={(e) => {
            setSaved(false);
            setNotes(e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">{t("notesHint")}</p>
      </div>

      <TotalsBlock result={result} money={money} />

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending || invalid || hasMissingPrice}
          onClick={() => save(false)}
        >
          {t("saveDraft")}
        </Button>
        {props.canIssue ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || invalid || hasMissingPrice || lines.length === 0}
            onClick={() => save(true)}
          >
            {t("saveAndIssue")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TotalsBlock({
  result,
  money,
}: {
  result: CalcResult | null;
  money: (value: string) => string;
}) {
  const t = useTranslations("Quotes");
  if (!result) return null;
  return (
    <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      <dt>{t("subtotal")}</dt>
      <dd dir="ltr">{money(result.subtotal)}</dd>
      <dt>{t("discount")}</dt>
      <dd dir="ltr">{money(result.discountTotal)}</dd>
      <dt>{t("tax")}</dt>
      <dd dir="ltr">{money(result.taxTotal)}</dd>
      <dt className="font-bold">{t("total")}</dt>
      <dd dir="ltr" className="font-bold">
        {money(result.total)}
      </dd>
      <dt className="text-muted-foreground">{t("margin")}</dt>
      <dd dir="ltr" className="text-muted-foreground">
        {result.margin
          ? `${money(result.margin.amount)} (${result.margin.pct ?? "—"}%)`
          : t("marginUnknown")}
      </dd>
    </dl>
  );
}
