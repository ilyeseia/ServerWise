"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { saveCompanyAction } from "./actions";

interface Company {
  name: string;
  phone: string;
  address: string;
}

export function SettingsForm({ initial, canEdit }: { initial: Company; canEdit: boolean }) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ variant: "success" | "danger"; text: string } | null>(
    null,
  );

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCompanyAction(values);
      setMessage(
        result.ok
          ? { variant: "success", text: t("saved") }
          : {
              variant: "danger",
              text: result.code === "forbidden" ? t("forbidden") : t("validation"),
            },
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {!canEdit ? <Alert>{t("readOnly")}</Alert> : null}
      {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}
      <Field id="company-name" label={t("companyName")}>
        <Input
          id="company-name"
          maxLength={120}
          value={values.name}
          disabled={!canEdit}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </Field>
      <Field id="company-phone" label={t("companyPhone")}>
        <Input
          id="company-phone"
          type="tel"
          dir="ltr"
          maxLength={40}
          value={values.phone}
          disabled={!canEdit}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
        />
      </Field>
      <Field id="company-address" label={t("companyAddress")}>
        <Textarea
          id="company-address"
          maxLength={300}
          value={values.address}
          disabled={!canEdit}
          onChange={(e) => setValues({ ...values, address: e.target.value })}
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
