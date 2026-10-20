"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { runAdvisorAction } from "./actions";

/** Runs the advisor with strict price rules unless the user explicitly relaxes them. */
export function AdvisorRunner({ leadId }: { leadId: string }) {
  const t = useTranslations("Advisor");
  const errorText = useErrorText();
  const router = useRouter();
  const [includeStale, setIncludeStale] = useState(false);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await runAdvisorAction(leadId, { includeStale, includeUnverified });
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      router.replace(`/leads/${leadId}?rec=${result.id}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("optionsNote")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => setIncludeStale(e.target.checked)}
          />
          {t("includeStale")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeUnverified}
            onChange={(e) => setIncludeUnverified(e.target.checked)}
          />
          {t("includeUnverified")}
        </label>
        <p className="text-xs text-muted-foreground">{t("optionsNote")}</p>
      </fieldset>
      <div>
        <Button type="button" disabled={pending} onClick={run}>
          {pending ? t("running") : t("run")}
        </Button>
      </div>
    </div>
  );
}
