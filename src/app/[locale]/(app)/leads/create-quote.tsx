"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createQuoteAction } from "../quotes/actions";

export function CreateQuote({ leadId, defaultTitle }: { leadId: string; defaultTitle: string }) {
  const t = useTranslations("Quotes");
  const errorText = useErrorText();
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createQuoteAction({ leadId, title });
      if (!result.ok) return setError(errorText(result.code));
      router.push(`/quotes/${result.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      {error ? (
        <Alert variant="danger" className="w-full">
          {error}
        </Alert>
      ) : null}
      <div className="min-w-64 flex-1">
        <Field id="quote-title" label={t("quoteTitle")}>
          <Input
            id="quote-title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending || title.trim() === ""}>
        {t("create")}
      </Button>
    </form>
  );
}
