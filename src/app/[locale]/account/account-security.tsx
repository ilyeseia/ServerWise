"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD = 12;

export function AccountSecurity({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <ChangePasswordCard />
      <TwoFactorCard enabled={twoFactorEnabled} />
    </div>
  );
}

function ChangePasswordCard() {
  const t = useTranslations("Account");
  const tAuth = useTranslations("Auth");
  const router = useRouter();
  const [message, setMessage] = useState<{ variant: "success" | "danger"; text: string } | null>(
    null,
  );

  const schema = z
    .object({
      currentPassword: z.string().min(1, t("wrongPassword")),
      newPassword: z.string().min(MIN_PASSWORD, t("passwordTooShort")).max(128),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordMismatch"),
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      path: ["newPassword"],
      message: t("passwordSame"),
    });
  type Values = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setMessage(null);
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setMessage({
        variant: "danger",
        text: error.status === 429 ? tAuth("tooManyAttempts") : t("wrongPassword"),
      });
      return;
    }
    reset();
    setMessage({ variant: "success", text: t("passwordChanged") });
    // The access gate (layout) decides where the user may go next.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("passwordTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}
          <Field
            id="currentPassword"
            label={t("currentPassword")}
            error={errors.currentPassword?.message}
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              aria-invalid={!!errors.currentPassword}
              {...register("currentPassword")}
            />
          </Field>
          <Field
            id="newPassword"
            label={t("newPassword")}
            hint={t("passwordHint")}
            error={errors.newPassword?.message}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              aria-invalid={!!errors.newPassword}
              {...register("newPassword")}
            />
          </Field>
          <Field
            id="confirmPassword"
            label={t("confirmPassword")}
            error={errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword")}
            />
          </Field>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t("changePassword")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Account");
  const tAuth = useTranslations("Auth");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [message, setMessage] = useState<{ variant: "success" | "danger"; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function startEnroll(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setPending(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || !("totpURI" in data)) {
        setMessage({ variant: "danger", text: t("wrongPassword") });
        return;
      }
      setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  async function confirmEnroll(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setPending(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
      if (error) {
        setMessage({ variant: "danger", text: tAuth("invalidCode") });
        return;
      }
      setCode("");
      setMessage({ variant: "success", text: t("twoFactorEnabledDone") });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setPending(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        setMessage({ variant: "danger", text: t("wrongPassword") });
        return;
      }
      setPassword("");
      setEnrollment(null);
      setMessage({ variant: "success", text: t("disabledDone") });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const secret = enrollment ? new URL(enrollment.totpURI).searchParams.get("secret") : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{t("twoFactorTitle")}</CardTitle>
          <Badge tone={enabled ? "success" : "neutral"}>
            {enabled ? t("twoFactorOn") : t("twoFactorOff")}
          </Badge>
        </div>
        <CardDescription>{t("twoFactorIntro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}

        {enrollment && !enabled ? (
          <form onSubmit={confirmEnroll} className="flex flex-col gap-4">
            <p className="text-sm">{t("scanQr")}</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={enrollment.totpURI} size={160} />
              </div>
              {secret ? (
                <code className="rounded bg-muted px-2 py-1 text-sm break-all select-all" dir="ltr">
                  {secret}
                </code>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("backupTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("backupNote")}</p>
              <ul className="grid grid-cols-2 gap-1 text-sm" dir="ltr">
                {enrollment.backupCodes.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            </div>
            <Field id="totp-code" label={t("enterCode")}>
              <Input
                id="totp-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
              />
            </Field>
            <div>
              <Button type="submit" disabled={pending || code.length < 6}>
                {t("verifyEnable")}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={enabled ? disable : startEnroll} className="flex flex-col gap-4">
            <Field id="twofactor-password" label={t("confirmWithPassword")}>
              <Input
                id="twofactor-password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <div>
              <Button
                type="submit"
                variant={enabled ? "outline" : "default"}
                disabled={pending || !password}
              >
                {enabled ? t("disable") : t("enable")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
