"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { savePricingAction } from "./actions";

export interface PricingValues {
  validityDays: number;
  taxRatesPct: string[];
  defaultTaxRatePct: string | null;
  markupPct: string | null;
  minMarginPct: string | null;
  laborRateDzdPerHour: string | null;
}

const nullable = (value: string) => (value.trim() === "" ? null : value.trim());

export function PricingForm({ initial, canEdit }: { initial: PricingValues; canEdit: boolean }) {
  const t = useTranslations("Pricing");
  const tc = useTranslations("Common");
  const errorText = useErrorText();
  const [validity, setValidity] = useState(String(initial.validityDays));
  const [rates, setRates] = useState(initial.taxRatesPct.join(", "));
  const [defaultRate, setDefaultRate] = useState(initial.defaultTaxRatePct ?? "");
  const [markup, setMarkup] = useState(initial.markupPct ?? "");
  const [minMargin, setMinMargin] = useState(initial.minMarginPct ?? "");
  const [labor, setLabor] = useState(initial.laborRateDzdPerHour ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ variant: "success" | "danger"; text: string } | null>(
    null,
  );

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await savePricingAction({
        validityDays: Number(validity),
        taxRatesPct: rates
          .split(/[,\s;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        defaultTaxRatePct: nullable(defaultRate),
        markupPct: nullable(markup),
        minMarginPct: nullable(minMargin),
        laborRateDzdPerHour: nullable(labor),
      });
      setMessage(
        result.ok
          ? { variant: "success", text: t("saved") }
          : { variant: "danger", text: errorText(result.code) },
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      {!canEdit ? <Alert>{t("readOnly")}</Alert> : null}
      {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}
      <Field id="pricing-validity" label={t("validityDays")}>
        <Input
          id="pricing-validity"
          dir="ltr"
          inputMode="numeric"
          value={validity}
          disabled={!canEdit}
          onChange={(e) => setValidity(e.target.value)}
        />
      </Field>
      <Field id="pricing-rates" label={t("taxRates")} hint={t("taxRatesHint")}>
        <Input
          id="pricing-rates"
          dir="ltr"
          value={rates}
          disabled={!canEdit}
          onChange={(e) => setRates(e.target.value)}
        />
      </Field>
      <Field id="pricing-default-rate" label={t("defaultTaxRate")}>
        <Input
          id="pricing-default-rate"
          dir="ltr"
          value={defaultRate}
          disabled={!canEdit}
          onChange={(e) => setDefaultRate(e.target.value)}
        />
      </Field>
      <Field id="pricing-markup" label={t("markup")} hint={t("markupHint")}>
        <Input
          id="pricing-markup"
          dir="ltr"
          value={markup}
          disabled={!canEdit}
          onChange={(e) => setMarkup(e.target.value)}
        />
      </Field>
      <Field id="pricing-margin" label={t("minMargin")} hint={t("minMarginHint")}>
        <Input
          id="pricing-margin"
          dir="ltr"
          value={minMargin}
          disabled={!canEdit}
          onChange={(e) => setMinMargin(e.target.value)}
        />
      </Field>
      <Field id="pricing-labor" label={t("laborRate")}>
        <Input
          id="pricing-labor"
          dir="ltr"
          value={labor}
          disabled={!canEdit}
          onChange={(e) => setLabor(e.target.value)}
        />
      </Field>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {tc("save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
