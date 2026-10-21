"use client";

import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/server/actions";

/** Runs a server action, shows its translated error, and refreshes the page on success. */
export function useAction() {
  const errorText = useErrorText();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<ActionResult<object>>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  return { error, pending, run };
}
