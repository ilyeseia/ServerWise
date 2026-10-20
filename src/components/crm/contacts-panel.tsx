"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  addContactAction,
  deleteContactAction,
  setPrimaryContactAction,
} from "@/app/[locale]/(app)/customers/actions";
import type { ContactRow } from "./types";
import { useErrorText } from "./use-error-text";

export function ContactsPanel({
  customerId,
  contacts,
  canWrite,
}: {
  customerId: string;
  contacts: ContactRow[];
  canWrite: boolean;
}) {
  const t = useTranslations("Crm.contacts");
  const tc = useTranslations("Common");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ name: "", jobTitle: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addContactAction(customerId, { ...values, isPrimary: false });
      if (result.ok) {
        setValues({ name: "", jobTitle: "", phone: "", email: "" });
        setOpen(false);
      } else setError(errorText(result.code));
    });
  }

  function act(action: () => Promise<{ ok: boolean; code?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(errorText(result.code ?? "UNKNOWN"));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  {c.name}
                  {c.isPrimary ? <Badge tone="success">{t("primary")}</Badge> : null}
                </span>
                {c.jobTitle ? (
                  <span className="text-xs text-muted-foreground">{c.jobTitle}</span>
                ) : null}
                {c.phone ? (
                  <span className="text-sm" dir="ltr">
                    {c.phone}
                  </span>
                ) : null}
                {c.email ? (
                  <span className="text-sm" dir="ltr">
                    {c.email}
                  </span>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {!c.isPrimary ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => act(() => setPrimaryContactAction(c.id))}
                    >
                      {t("makePrimary")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t("deleteConfirm"))) act(() => deleteContactAction(c.id));
                    }}
                  >
                    {t("delete")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        open ? (
          <form
            onSubmit={submit}
            className="flex max-w-xl flex-col gap-3 rounded-md border border-border p-4"
          >
            <Field id="contact-name" label={t("name")}>
              <Input
                id="contact-name"
                required
                minLength={2}
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </Field>
            <Field id="contact-title" label={t("jobTitle")}>
              <Input
                id="contact-title"
                value={values.jobTitle}
                onChange={(e) => setValues({ ...values, jobTitle: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="contact-phone" label={t("phone")}>
                <Input
                  id="contact-phone"
                  type="tel"
                  dir="ltr"
                  value={values.phone}
                  onChange={(e) => setValues({ ...values, phone: e.target.value })}
                />
              </Field>
              <Field id="contact-email" label={t("email")}>
                <Input
                  id="contact-email"
                  type="email"
                  dir="ltr"
                  value={values.email}
                  onChange={(e) => setValues({ ...values, email: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {tc("save")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t("add")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
