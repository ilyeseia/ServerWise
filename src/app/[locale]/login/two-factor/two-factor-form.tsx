"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const value = code.replace(/\s+/g, "");
    if (!value) {
      setError(t("codeRequired"));
      return;
    }
    setPending(true);
    try {
      const { error: verifyError } = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value });
      if (verifyError) {
        setError(verifyError.status === 429 ? t("tooManyAttempts") : t("invalidCode"));
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {useBackup ? t("backupSubtitle") : t("twoFactorSubtitle")}
      </p>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Field id="code" label={useBackup ? t("backupCode") : t("code")}>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          dir="ltr"
          autoFocus
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? t("verifying") : t("verify")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setUseBackup((v) => !v);
          setCode("");
          setError(null);
        }}
      >
        {useBackup ? t("useAuthenticator") : t("useBackupCode")}
      </Button>
    </form>
  );
}
