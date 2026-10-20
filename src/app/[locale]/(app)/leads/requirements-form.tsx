"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { visibleQuestions } from "@/modules/questionnaire/engine";
import type {
  AnswerValue,
  Answers,
  Question,
  QuestionnaireDefinition,
  ValidationCode,
} from "@/modules/questionnaire/types";
import { saveRequirementsAction } from "./actions";

/**
 * Renders the questionnaire the stored answers belong to. Only questions that apply to the
 * current answers are shown (the same engine runs on the server, which has the final say).
 */
export function RequirementsForm({
  leadId,
  definition,
  initialAnswers,
  initialStatus,
  saved,
  canEdit,
}: {
  leadId: string;
  definition: QuestionnaireDefinition;
  initialAnswers: Answers;
  initialStatus: "draft" | "complete";
  saved: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("Requirements");
  const errorText = useErrorText();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [status, setStatus] = useState(initialStatus);
  const [errors, setErrors] = useState<Record<string, ValidationCode>>({});
  const [message, setMessage] = useState<{ variant: "success" | "danger"; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  // next-intl types message keys from the Arabic file; question ids are data, so cast here.
  const label = (key: string) => t(key as never);
  const hasKey = (key: string) => t.has(key as never);

  const visible = new Set(visibleQuestions(definition, answers).map((q) => q.id));

  function setAnswer(id: string, value: AnswerValue | undefined) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || value === "") delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function save(complete: boolean) {
    setMessage(null);
    setErrors({});
    startTransition(async () => {
      const result = await saveRequirementsAction(leadId, answers, complete);
      if (result.ok) {
        setStatus(result.status);
        setMessage({ variant: "success", text: complete ? t("savedComplete") : t("savedDraft") });
      } else if (result.errors) {
        setErrors(result.errors);
        setMessage({ variant: "danger", text: t("incomplete") });
      } else {
        setMessage({ variant: "danger", text: errorText(result.code) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={status === "complete" ? "success" : "neutral"}>
          {status === "complete" ? t("statusComplete") : t("statusDraft")}
        </Badge>
        <span className="text-muted-foreground">
          {t("version", { version: definition.version })}
        </span>
        {!saved ? <span className="text-muted-foreground">· {t("notStarted")}</span> : null}
      </div>

      {!canEdit ? <Alert>{t("readOnly")}</Alert> : null}
      {message ? <Alert variant={message.variant}>{message.text}</Alert> : null}

      {definition.sections.map((section) => {
        const questions = section.questions.filter((q) => visible.has(q.id));
        if (questions.length === 0) return null;
        return (
          <fieldset
            key={section.id}
            className="flex flex-col gap-4 rounded-md border border-border p-4"
            disabled={!canEdit}
          >
            <legend className="px-2 text-sm font-semibold">
              {label(`sections.${section.id}`)}
            </legend>
            {questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={answers[q.id]}
                error={errors[q.id]}
                onChange={(value) => setAnswer(q.id, value)}
                label={label}
                hasKey={hasKey}
              />
            ))}
          </fieldset>
        );
      })}

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
            {t("saveDraft")}
          </Button>
          <Button type="button" disabled={pending} onClick={() => save(true)}>
            {t("markComplete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function QuestionField({
  question,
  value,
  error,
  onChange,
  label,
  hasKey,
}: {
  question: Question;
  value: AnswerValue | undefined;
  error: ValidationCode | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  label: (key: string) => string;
  hasKey: (key: string) => boolean;
}) {
  const id = `q-${question.id}`;
  const title = label(`q.${question.id}`);
  const hint = hasKey(`hint.${question.id}`) ? label(`hint.${question.id}`) : undefined;
  const errorMessage = error ? label(`errors.${error}`) : undefined;
  const requiredMark = question.required ? ` (${label("required")})` : "";

  switch (question.kind) {
    case "boolean":
      return (
        <fieldset
          className="flex flex-col gap-1.5"
          aria-describedby={errorMessage ? `${id}-error` : undefined}
        >
          <legend className="text-sm font-medium">
            {title}
            {requiredMark}
          </legend>
          <div className="flex gap-4">
            {([true, false] as const).map((option) => (
              <label key={String(option)} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={id}
                  checked={value === option}
                  onChange={() => onChange(option)}
                />
                {option ? label("yes") : label("no")}
              </label>
            ))}
          </div>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          {errorMessage ? (
            <p id={`${id}-error`} role="alert" className="text-xs text-danger">
              {errorMessage}
            </p>
          ) : null}
        </fieldset>
      );

    case "single":
      return (
        <Field id={id} label={`${title}${requiredMark}`} hint={hint} error={errorMessage}>
          <Select
            id={id}
            value={typeof value === "string" ? value : ""}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <option value="">{label("select")}</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {label(`o.${question.id}.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
      );

    case "multi": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset
          className="flex flex-col gap-1.5"
          aria-describedby={errorMessage ? `${id}-error` : undefined}
        >
          <legend className="text-sm font-medium">
            {title}
            {requiredMark}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {question.options.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, option]
                        : selected.filter((o) => o !== option),
                    )
                  }
                />
                {label(`o.${question.id}.${option}`)}
              </label>
            ))}
          </div>
          {errorMessage ? (
            <p id={`${id}-error`} role="alert" className="text-xs text-danger">
              {errorMessage}
            </p>
          ) : null}
        </fieldset>
      );
    }

    case "number":
      return (
        <Field id={id} label={`${title}${requiredMark}`} hint={hint} error={errorMessage}>
          <Input
            id={id}
            type="number"
            dir="ltr"
            inputMode="decimal"
            min={question.min}
            max={question.max}
            step={question.integer ? 1 : "any"}
            value={typeof value === "number" ? value : ""}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      );

    case "text":
      return (
        <Field id={id} label={`${title}${requiredMark}`} hint={hint} error={errorMessage}>
          {question.maxLength > 300 ? (
            <Textarea
              id={id}
              maxLength={question.maxLength}
              value={typeof value === "string" ? value : ""}
              aria-invalid={!!error}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <Input
              id={id}
              maxLength={question.maxLength}
              value={typeof value === "string" ? value : ""}
              aria-invalid={!!error}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      );
  }
}
