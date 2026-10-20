"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createRevisionAction, decideRevisionAction } from "../actions";

/** What can be done with an issued revision: record the answer, or start a new revision. */
export function RevisionControls({
  quoteId,
  revisionId,
  canDecide,
  canRevise,
}: {
  quoteId: string;
  revisionId: string;
  canDecide: boolean;
  canRevise: boolean;
}) {
  const t = useTranslations("Quotes");
  const errorText = useErrorText();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "accepted" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await decideRevisionAction(revisionId, { decision, note });
      if (!result.ok) return setError(errorText(result.code));
      router.refresh();
    });
  }

  function revise() {
    setError(null);
    startTransition(async () => {
      const result = await createRevisionAction(quoteId);
      if (!result.ok) return setError(errorText(result.code));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {canDecide ? (
        <div className="flex flex-col gap-3">
          <Field id="decision-note" label={t("decisionNote")}>
            <Input
              id="decision-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={() => decide("accepted")}>
              {t("markAccepted")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => decide("rejected")}
            >
              {t("markRejected")}
            </Button>
          </div>
        </div>
      ) : null}
      {canRevise ? (
        <div>
          <Button type="button" variant="outline" disabled={pending} onClick={revise}>
            {t("newRevision")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
