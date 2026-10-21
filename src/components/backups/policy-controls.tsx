"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  markReviewedAction,
  recordBackupAction,
  recordRestoreTestAction,
  saveRecoveryAction,
} from "@/app/[locale]/(app)/backup-actions";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { BACKUP_OUTCOMES, RESTORE_OUTCOMES } from "@/modules/backups/rules";

const today = () => new Date().toISOString().slice(0, 10);

/** The step-by-step recovery documentation, with an explicit "I reviewed it" button. */
export function RecoveryEditor({
  policyId,
  initial,
  canEdit,
  hasProcedure,
}: {
  policyId: string;
  initial: string;
  canEdit: boolean;
  hasProcedure: boolean;
}) {
  const t = useTranslations("Backups");
  const save = useAction();
  const review = useAction();
  const [text, setText] = useState(initial);

  return (
    <div className="flex flex-col gap-3">
      {save.error ? <Alert variant="danger">{save.error}</Alert> : null}
      {review.error ? <Alert variant="danger">{review.error}</Alert> : null}
      <Field id="recovery-procedure" label={t("recoveryProcedure")} hint={t("recoveryHint")}>
        <Textarea
          id="recovery-procedure"
          maxLength={4000}
          className="min-h-48"
          value={text}
          disabled={!canEdit}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={save.pending}
            onClick={() => save.run(() => saveRecoveryAction(policyId, text))}
          >
            {t("saveRecovery")}
          </Button>
          {hasProcedure ? (
            <Button
              type="button"
              variant="outline"
              disabled={review.pending}
              onClick={() => review.run(() => markReviewedAction(policyId))}
            >
              {t("markReviewed")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Records one backup run. */
export function RecordBackup({ policyId }: { policyId: string }) {
  const t = useTranslations("Backups");
  const tOutcome = useTranslations("Backups.outcome");
  const action = useAction();
  const [ranAt, setRanAt] = useState(today());
  const [outcome, setOutcome] = useState<(typeof BACKUP_OUTCOMES)[number]>("success");
  const [sizeMb, setSizeMb] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(
          () => recordBackupAction(policyId, { ranAt, outcome, sizeMb, notes }),
          () => {
            setNotes("");
            setSizeMb("");
          },
        );
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="run-date" label={t("ranAt")}>
          <Input id="run-date" type="date" dir="ltr" required value={ranAt} onChange={(e) => setRanAt(e.target.value)} />
        </Field>
        <Field id="run-outcome" label={t("outcomeLabel")}>
          <Select
            id="run-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          >
            {BACKUP_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {tOutcome(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="run-size" label={t("sizeMb")}>
          <Input id="run-size" dir="ltr" inputMode="numeric" value={sizeMb} onChange={(e) => setSizeMb(e.target.value)} />
        </Field>
      </div>
      <Field id="run-notes" label={t("notes")}>
        <Input id="run-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={action.pending || !ranAt}>
          {t("recordBackup")}
        </Button>
      </div>
    </form>
  );
}

/** Records one restore drill: the proof that a backup can really be restored. */
export function RecordRestoreTest({ policyId }: { policyId: string }) {
  const t = useTranslations("Backups");
  const tOutcome = useTranslations("Backups.outcome");
  const action = useAction();
  const [testedAt, setTestedAt] = useState(today());
  const [outcome, setOutcome] = useState<(typeof RESTORE_OUTCOMES)[number]>("success");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(
          () =>
            recordRestoreTestAction(policyId, {
              testedAt,
              outcome,
              durationMinutes: duration,
              notes,
            }),
          () => {
            setNotes("");
            setDuration("");
          },
        );
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="drill-date" label={t("testedAt")}>
          <Input id="drill-date" type="date" dir="ltr" required value={testedAt} onChange={(e) => setTestedAt(e.target.value)} />
        </Field>
        <Field id="drill-outcome" label={t("outcomeLabel")}>
          <Select
            id="drill-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          >
            {RESTORE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {tOutcome(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="drill-duration" label={t("durationMinutes")}>
          <Input id="drill-duration" dir="ltr" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>
      <Field id="drill-notes" label={t("notes")} hint={t("drillHint")}>
        <Input id="drill-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={action.pending || !testedAt}>
          {t("recordRestore")}
        </Button>
      </div>
    </form>
  );
}
