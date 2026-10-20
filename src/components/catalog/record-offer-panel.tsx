"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { recordOfferAction } from "@/app/[locale]/(app)/catalog/actions";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { AVAILABILITIES, OFFER_CONDITIONS, offerInput } from "@/modules/catalog/schemas";
import { WILAYAS } from "@/modules/crm/wilayas";

type FormState = {
  supplierId: string;
  priceDzd: string;
  condition: (typeof OFFER_CONDITIONS)[number];
  availability: (typeof AVAILABILITIES)[number];
  warrantyMonths: string;
  locationWilayaCode: string;
  sourceUrl: string;
  quoteReference: string;
  checkedAt: string;
  notes: string;
};

export interface SupplierOption {
  id: string;
  name: string;
}

/** Records one price observation. A link or a quotation reference is mandatory. */
export function RecordOfferPanel({
  productId,
  suppliers,
}: {
  productId: string;
  suppliers: SupplierOption[];
}) {
  const t = useTranslations("Catalog.offer");
  const tc = useTranslations("Common");
  const errorText = useErrorText();
  const locale = useLocale() as "ar" | "fr";
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    supplierId: suppliers[0]?.id ?? "",
    priceDzd: "",
    condition: "new",
    availability: "unknown",
    warrantyMonths: "",
    locationWilayaCode: "",
    sourceUrl: "",
    quoteReference: "",
    checkedAt: "",
    notes: "",
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (suppliers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noSuppliers")}</p>;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    // Empty "checked at" means "now" (avoids a server/browser clock mismatch in the initial value).
    const checkedAt = form.checkedAt
      ? new Date(form.checkedAt).toISOString()
      : new Date().toISOString();
    const payload = { productId, ...form, checkedAt };

    const parsed = offerInput.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] ??=
          key === "priceDzd"
            ? t("priceRequired")
            : key === "sourceUrl" || key === "quoteReference"
              ? issue.message === "invalid_url"
                ? errorText("VALIDATION")
                : t("evidenceRequired")
              : key === "supplierId"
                ? t("supplierRequired")
                : errorText("VALIDATION");
      }
      setErrors(next);
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await recordOfferAction(payload);
      if (result.ok) {
        setForm((f) => ({
          ...f,
          priceDzd: "",
          sourceUrl: "",
          quoteReference: "",
          checkedAt: "",
          notes: "",
        }));
        setOpen(false);
      } else setError(errorText(result.code));
    });
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("record")}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-w-2xl flex-col gap-4 rounded-md border border-border p-4"
    >
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="offer-supplier" label={t("supplier")} error={errors.supplierId}>
          <Select
            id="offer-supplier"
            value={form.supplierId}
            onChange={(e) => set("supplierId", e.target.value)}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="offer-price" label={`${t("price")}`} error={errors.priceDzd}>
          <Input
            id="offer-price"
            dir="ltr"
            inputMode="decimal"
            value={form.priceDzd}
            aria-invalid={!!errors.priceDzd}
            onChange={(e) => set("priceDzd", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="offer-condition" label={t("condition")}>
          <Select
            id="offer-condition"
            value={form.condition}
            onChange={(e) => set("condition", e.target.value as FormState["condition"])}
          >
            {OFFER_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`conditions.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="offer-availability" label={t("availability")}>
          <Select
            id="offer-availability"
            value={form.availability}
            onChange={(e) => set("availability", e.target.value as FormState["availability"])}
          >
            {AVAILABILITIES.map((a) => (
              <option key={a} value={a}>
                {t(`availabilities.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="offer-warranty" label={`${t("warranty")}`}>
          <Input
            id="offer-warranty"
            dir="ltr"
            inputMode="numeric"
            value={form.warrantyMonths}
            onChange={(e) => set("warrantyMonths", e.target.value)}
          />
        </Field>
      </div>

      <Field id="offer-location" label={t("location")}>
        <Select
          id="offer-location"
          value={form.locationWilayaCode}
          onChange={(e) => set("locationWilayaCode", e.target.value)}
        >
          <option value="">—</option>
          {WILAYAS.map((w) => (
            <option key={w.code} value={String(w.code)}>
              {w.code} · {w[locale]}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-2 text-sm font-semibold">{t("source")}</legend>
        <p className="text-xs text-muted-foreground">{t("evidenceHint")}</p>
        <Field id="offer-source" label={t("source")} error={errors.sourceUrl}>
          <Input
            id="offer-source"
            type="url"
            dir="ltr"
            value={form.sourceUrl}
            aria-invalid={!!errors.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
          />
        </Field>
        <Field id="offer-quote" label={t("quoteRef")}>
          <Input
            id="offer-quote"
            value={form.quoteReference}
            onChange={(e) => set("quoteReference", e.target.value)}
          />
        </Field>
      </fieldset>

      <Field id="offer-checked" label={t("checkedAt")} hint={t("checkedHint")}>
        <Input
          id="offer-checked"
          type="datetime-local"
          dir="ltr"
          value={form.checkedAt}
          onChange={(e) => set("checkedAt", e.target.value)}
        />
      </Field>
      <Field id="offer-notes" label={t("notes")}>
        <Textarea
          id="offer-notes"
          maxLength={1000}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
