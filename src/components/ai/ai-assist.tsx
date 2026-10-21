"use client";

import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { runAiToolAction } from "@/app/[locale]/(app)/ai-actions";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { AiResult } from "@/modules/ai/gateway";

interface Props {
  /** The tool id, for example "summarize_customer". */
  tool: string;
  /** What the tool needs besides the language (an id, usually). */
  input: Record<string, unknown>;
  /** Button label. */
  label: string;
  /** Some drafts need the person's goal first. */
  askGoal?: { label: string; placeholder?: string };
}

const UNAVAILABLE_CODES = [
  "not_configured",
  "timeout",
  "network",
  "auth",
  "rate_limited",
  "provider_error",
] as const;
type UnavailableCode = (typeof UNAVAILABLE_CODES)[number];

/**
 * A button that asks the assistant and shows its answer as plain text, labelled as a draft for a
 * person to check. It never saves, sends or changes anything.
 */
export function AiAssist({ tool, input, label, askGoal }: Props) {
  const t = useTranslations("Ai");
  const tUnavailable = useTranslations("Ai.unavailable");
  const errorText = useErrorText();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [goal, setGoal] = useState("");
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function ask() {
    setError(null);
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      const response = await runAiToolAction(tool, {
        ...input,
        ...(askGoal ? { goal } : {}),
        language: locale === "fr" ? "fr" : "ar",
      });
      if (!response.ok) return setError(errorText(response.code));
      setResult(response.result);
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the text is still selectable on screen.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {askGoal ? (
        <Field id={`ai-goal-${tool}`} label={askGoal.label}>
          <Input
            id={`ai-goal-${tool}`}
            maxLength={500}
            placeholder={askGoal.placeholder}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </Field>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending || (askGoal ? goal.trim().length < 3 : false)}
          onClick={ask}
        >
          <Sparkles aria-hidden="true" className="size-4" />
          {pending ? t("thinking") : label}
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {result?.status === "unavailable" ? (
          <Alert>
            {tUnavailable(
              (UNAVAILABLE_CODES as readonly string[]).includes(result.code)
                ? (result.code as UnavailableCode)
                : "provider_error",
            )}
          </Alert>
        ) : null}
        {result?.status === "invalid" ? <Alert variant="danger">{t("invalid")}</Alert> : null}
        {result?.status === "limited" ? (
          <Alert>{t("limited", { limit: result.limit })}</Alert>
        ) : null}
        {result?.status === "needs_confirmation" ? <Alert>{t("needsConfirmation")}</Alert> : null}

        {result?.status === "ok" ? (
          <section
            aria-label={t("answer")}
            className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4"
          >
            <p className="text-xs font-medium text-muted-foreground">{t("draftNotice")}</p>
            {result.output.subject ? (
              <p className="text-sm font-semibold">{result.output.subject}</p>
            ) : null}
            <p className="text-sm whitespace-pre-wrap">{result.output.text}</p>
            {result.output.points.length > 0 ? (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {result.output.points.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            ) : null}
            {result.redacted ? <Alert>{t("redacted")}</Alert> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  copy(
                    [
                      result.output.subject,
                      result.output.text,
                      ...result.output.points.map((p) => `- ${p}`),
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  )
                }
              >
                {copied ? t("copied") : t("copy")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("basedOn", { count: result.sources.length })} ·{" "}
                {t("remaining", { count: result.remaining })}
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
