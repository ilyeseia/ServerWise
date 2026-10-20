"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import type { PersonOption } from "@/components/crm/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { LEAD_SOURCES } from "@/modules/crm/schemas";
import { createLeadAction, updateLeadAction } from "./actions";

export interface LeadFormValues {
  customerId: string;
  title: string;
  source: (typeof LEAD_SOURCES)[number];
  budgetMinDzd: string;
  budgetMaxDzd: string;
  ownerId: string;
  notes: string;
}

export function LeadForm({
  leadId,
  initial,
  customers,
  owners,
  lockedCustomer,
}: {
  leadId?: string;
  initial: LeadFormValues;
  customers: PersonOption[];
  owners: PersonOption[];
  /** Name of the customer when the lead is created from a customer page or edited. */
  lockedCustomer?: string;
}) {
  const t = useTranslations("Crm.leads");
  const tc = useTranslations("Common");
  const tSource = useTranslations("Crm.leadSource");
  const errorText = useErrorText();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const min = values.budgetMinDzd === "" ? undefined : Number(values.budgetMinDzd);
    const max = values.budgetMaxDzd === "" ? undefined : Number(values.budgetMaxDzd);
    if (min !== undefined && max !== undefined && max < min) {
      setFieldErrors({ budgetMaxDzd: t("budgetRange") });
      return;
    }

    startTransition(async () => {
      const common = {
        title: values.title,
        source: values.source,
        budgetMinDzd: values.budgetMinDzd,
        budgetMaxDzd: values.budgetMaxDzd,
        ownerId: values.ownerId,
        notes: values.notes,
      };
      if (leadId) {
        const result = await updateLeadAction(leadId, common);
        if (result.ok) {
          router.push(`/leads/${leadId}`);
          router.refresh();
        } else setError(errorText(result.code));
      } else {
        const result = await createLeadAction({ customerId: values.customerId, ...common });
        if (result.ok) {
          router.push(`/leads/${result.id}`);
          router.refresh();
        } else setError(errorText(result.code));
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {lockedCustomer ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("customerField")}</span>
          <span className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
            {lockedCustomer}
          </span>
        </div>
      ) : (
        <Field id="customerId" label={t("customerField")}>
          <Select
            id="customerId"
            required
            value={values.customerId}
            onChange={(e) => set("customerId", e.target.value)}
          >
            <option value="">—</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field id="title" label={t("titleField")}>
        <Input
          id="title"
          required
          minLength={2}
          maxLength={200}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="source" label={t("source")}>
          <Select
            id="source"
            value={values.source}
            onChange={(e) => set("source", e.target.value as LeadFormValues["source"])}
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {tSource(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ownerId" label={t("owner")}>
          <Select
            id="ownerId"
            value={values.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="budgetMinDzd" label={t("budgetMin")}>
          <Input
            id="budgetMinDzd"
            type="number"
            min={0}
            step="1"
            dir="ltr"
            value={values.budgetMinDzd}
            onChange={(e) => set("budgetMinDzd", e.target.value)}
          />
        </Field>
        <Field id="budgetMaxDzd" label={t("budgetMax")} error={fieldErrors.budgetMaxDzd}>
          <Input
            id="budgetMaxDzd"
            type="number"
            min={0}
            step="1"
            dir="ltr"
            aria-invalid={!!fieldErrors.budgetMaxDzd}
            value={values.budgetMaxDzd}
            onChange={(e) => set("budgetMaxDzd", e.target.value)}
          />
        </Field>
      </div>

      <Field id="notes" label={t("notes")}>
        <Textarea
          id="notes"
          maxLength={2000}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
