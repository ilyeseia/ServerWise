"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { decideOfferAction, setProductActiveAction } from "@/app/[locale]/(app)/catalog/actions";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Owner-only: confirm or reject a recorded price after checking its source. */
export function VerifyControls({ offerId }: { offerId: string }) {
  const t = useTranslations("Catalog.offer");
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "verified" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await decideOfferAction(offerId, decision);
      if (!result.ok) setError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("verified")}>
          {t("verify")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => decide("rejected")}
        >
          {t("reject")}
        </Button>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}

export function ProductActiveControl({
  productId,
  active,
}: {
  productId: string;
  active: boolean;
}) {
  const t = useTranslations("Catalog.detail");
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setProductActiveAction(productId, !active);
      if (!result.ok) setError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {active ? t("deactivate") : t("reactivate")}
      </Button>
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}
