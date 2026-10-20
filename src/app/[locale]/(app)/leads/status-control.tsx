"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { LeadStatus } from "@/modules/crm/lead-status";
import { changeLeadStatusAction } from "./actions";

/** Only the transitions the state machine allows are offered; the server enforces them too. */
export function LeadStatusControl({
  leadId,
  next,
}: {
  leadId: string;
  next: readonly LeadStatus[];
}) {
  const t = useTranslations("Crm.leads");
  const tStatus = useTranslations("Crm.leadStatus");
  const errorText = useErrorText();
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (next.length === 0) return <p className="text-sm text-muted-foreground">{t("noNext")}</p>;

  function move(to: LeadStatus, lostReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeLeadStatusAction(leadId, to, lostReason);
      if (!result.ok) setError(errorText(result.code));
      else {
        setAskReason(false);
        setReason("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("moveTo")}>
        <span className="text-sm font-medium">{t("moveTo")}:</span>
        {next.map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={status === "lost" ? "outline" : "default"}
            disabled={pending}
            onClick={() => (status === "lost" ? setAskReason(true) : move(status))}
          >
            {tStatus(status)}
          </Button>
        ))}
      </div>

      {askReason ? (
        <div className="flex max-w-md flex-col gap-3 rounded-md border border-border p-3">
          <Field id="lost-reason" label={t("lostReason")}>
            <Input
              id="lost-reason"
              value={reason}
              maxLength={300}
              placeholder={t("lostReasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={pending || reason.trim().length < 2}
              onClick={() => move("lost", reason)}
            >
              {t("confirmLost")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}
