"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { customerInput } from "@/modules/crm/schemas";
import { WILAYAS } from "@/modules/crm/wilayas";
import { createCustomerAction, updateCustomerAction } from "./actions";

export interface CustomerFormValues {
  type: "individual" | "business";
  name: string;
  legalName: string;
  taxId: string;
  phone: string;
  email: string;
  wilayaCode: string;
  address: string;
  preferredLanguage: "ar" | "fr";
  notes: string;
}

export const EMPTY_CUSTOMER: CustomerFormValues = {
  type: "individual",
  name: "",
  legalName: "",
  taxId: "",
  phone: "",
  email: "",
  wilayaCode: "",
  address: "",
  preferredLanguage: "ar",
  notes: "",
};

export function CustomerForm({
  customerId,
  initial = EMPTY_CUSTOMER,
}: {
  customerId?: string;
  initial?: CustomerFormValues;
}) {
  const t = useTranslations("Crm.customerForm");
  const tc = useTranslations("Common");
  const tType = useTranslations("Crm.type");
  const tLang = useTranslations("Crm.language");
  const errorText = useErrorText();
  const locale = useLocale() as "ar" | "fr";
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function messageFor(field: string): string {
    if (field === "phone") return t("invalidPhone");
    if (field === "email") return t("invalidEmail");
    if (field === "name") return t("nameRequired");
    return errorText("VALIDATION");
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const business = values.type === "business";
    const payload = {
      ...values,
      legalName: business ? values.legalName : "",
      taxId: business ? values.taxId : "",
    };

    const parsed = customerInput.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        errors[String(issue.path[0])] ??= messageFor(String(issue.path[0]));
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      if (customerId) {
        const result = await updateCustomerAction(customerId, payload);
        if (result.ok) {
          router.push(`/customers/${customerId}`);
          router.refresh();
        } else setError(errorText(result.code));
      } else {
        const result = await createCustomerAction(payload);
        if (result.ok) {
          router.push(`/customers/${result.id}`);
          router.refresh();
        } else {
          if (result.fields) {
            setFieldErrors(
              Object.fromEntries(Object.keys(result.fields).map((f) => [f, messageFor(f)])),
            );
          }
          setError(errorText(result.code));
        }
      }
    });
  }

  const business = values.type === "business";

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field id="type" label={t("type")}>
        <Select
          id="type"
          value={values.type}
          onChange={(e) => set("type", e.target.value as "individual" | "business")}
        >
          <option value="individual">{tType("individual")}</option>
          <option value="business">{tType("business")}</option>
        </Select>
      </Field>

      <Field id="name" label={t("name")} error={fieldErrors.name}>
        <Input
          id="name"
          value={values.name}
          maxLength={200}
          aria-invalid={!!fieldErrors.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      {business ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="legalName" label={t("legalName")}>
            <Input
              id="legalName"
              value={values.legalName}
              maxLength={200}
              onChange={(e) => set("legalName", e.target.value)}
            />
          </Field>
          <Field id="taxId" label={t("taxId")}>
            <Input
              id="taxId"
              dir="ltr"
              value={values.taxId}
              maxLength={40}
              onChange={(e) => set("taxId", e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label={t("phone")} error={fieldErrors.phone}>
          <Input
            id="phone"
            type="tel"
            dir="ltr"
            value={values.phone}
            aria-invalid={!!fieldErrors.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field id="email" label={t("email")} error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            dir="ltr"
            value={values.email}
            aria-invalid={!!fieldErrors.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="wilayaCode" label={t("wilaya")}>
          <Select
            id="wilayaCode"
            value={values.wilayaCode}
            onChange={(e) => set("wilayaCode", e.target.value)}
          >
            <option value="">—</option>
            {WILAYAS.map((w) => (
              <option key={w.code} value={String(w.code)}>
                {w.code} · {w[locale]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="preferredLanguage" label={t("language")}>
          <Select
            id="preferredLanguage"
            value={values.preferredLanguage}
            onChange={(e) => set("preferredLanguage", e.target.value as "ar" | "fr")}
          >
            <option value="ar">{tLang("ar")}</option>
            <option value="fr">{tLang("fr")}</option>
          </Select>
        </Field>
      </div>

      <Field id="address" label={t("address")}>
        <Input
          id="address"
          value={values.address}
          maxLength={300}
          onChange={(e) => set("address", e.target.value)}
        />
      </Field>

      <Field id="notes" label={t("notes")}>
        <Textarea
          id="notes"
          value={values.notes}
          maxLength={2000}
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
