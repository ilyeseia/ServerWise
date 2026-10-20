"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  archiveCustomerAction,
  restoreCustomerAction,
} from "@/app/[locale]/(app)/customers/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useErrorText } from "./use-error-text";

export function ArchiveControls({
  customerId,
  archived,
}: {
  customerId: string;
  archived: boolean;
}) {
  const t = useTranslations("Crm.customer");
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    if (!archived && !window.confirm(t("archiveConfirm"))) return;
    setError(null);
    startTransition(async () => {
      const result = await (archived
        ? restoreCustomerAction(customerId)
        : archiveCustomerAction(customerId));
      if (!result.ok) setError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={run}>
        {archived ? t("restore") : t("archive")}
      </Button>
      {error ? (
        <Alert variant="danger" className="max-w-xs">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
