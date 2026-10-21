"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelContractAction,
  createScheduleAction,
  generateRemindersAction,
  recordServiceReportAction,
  updateScheduleAction,
} from "@/app/[locale]/(app)/care-actions";
import { useAction } from "@/components/projects/use-action";
import type { StaffVM } from "@/components/projects/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

/** Adds a recurring visit to a contract. */
export function AddSchedule({ contractId, staff }: { contractId: string; staff: StaffVM[] }) {
  const t = useTranslations("Maintenance");
  const action = useAction();
  const [title, setTitle] = useState("");
  const [interval, setInterval] = useState("3");
  const [anchor, setAnchor] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(
          () =>
            createScheduleAction(contractId, {
              title,
              intervalMonths: Number(interval),
              anchorDate: anchor,
              assigneeId,
              active: true,
            }),
          () => {
            setTitle("");
            setAnchor("");
          },
        );
      }}
    >
      <h4 className="font-medium">{t("addSchedule")}</h4>
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <Field id="schedule-title" label={t("scheduleTitle")}>
        <Input
          id="schedule-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="schedule-interval" label={t("intervalMonths")}>
          <Input
            id="schedule-interval"
            dir="ltr"
            inputMode="numeric"
            required
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </Field>
        <Field id="schedule-anchor" label={t("firstVisit")}>
          <Input
            id="schedule-anchor"
            type="date"
            dir="ltr"
            required
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
          />
        </Field>
        <Field id="schedule-assignee" label={t("assignee")}>
          <Select
            id="schedule-assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button
          type="submit"
          variant="outline"
          disabled={action.pending || !title.trim() || !anchor}
        >
          {t("addSchedule")}
        </Button>
      </div>
    </form>
  );
}

/** Records a visit for one schedule, and can switch the schedule on or off. */
export function ScheduleActions({
  scheduleId,
  title,
  intervalMonths,
  anchorDate,
  assigneeId,
  active,
  canPerform,
  canManage,
}: {
  scheduleId: string;
  title: string;
  intervalMonths: number;
  anchorDate: string;
  assigneeId: string;
  active: boolean;
  canPerform: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("Maintenance");
  const visit = useAction();
  const toggle = useAction();
  const [open, setOpen] = useState(false);
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const [parts, setParts] = useState("");

  return (
    <div className="flex flex-col gap-2">
      {visit.error ? <Alert variant="danger">{visit.error}</Alert> : null}
      {toggle.error ? <Alert variant="danger">{toggle.error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {canPerform && active ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={open}
            aria-label={`${title}: ${t("recordVisit")}`}
            onClick={() => setOpen((v) => !v)}
          >
            {t("recordVisit")}
          </Button>
        ) : null}
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={toggle.pending}
            aria-label={`${title}: ${active ? t("deactivate") : t("activate")}`}
            onClick={() =>
              toggle.run(() =>
                updateScheduleAction(scheduleId, {
                  title,
                  intervalMonths,
                  anchorDate,
                  assigneeId,
                  active: !active,
                }),
              )
            }
          >
            {active ? t("deactivate") : t("activate")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            visit.run(
              () =>
                recordServiceReportAction({
                  scheduleId,
                  performedAt,
                  summary,
                  partsReplaced: parts,
                }),
              () => {
                setOpen(false);
                setSummary("");
                setParts("");
              },
            );
          }}
        >
          <Field id={`visit-date-${scheduleId}`} label={t("performedAt")}>
            <Input
              id={`visit-date-${scheduleId}`}
              type="date"
              dir="ltr"
              required
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
            />
          </Field>
          <Field id={`visit-summary-${scheduleId}`} label={t("summary")}>
            <Textarea
              id={`visit-summary-${scheduleId}`}
              required
              maxLength={2000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
          <Field id={`visit-parts-${scheduleId}`} label={t("partsReplaced")}>
            <Input
              id={`visit-parts-${scheduleId}`}
              maxLength={1000}
              value={parts}
              onChange={(e) => setParts(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" disabled={visit.pending || !summary.trim()}>
              {t("saveVisit")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function CancelContract({ contractId }: { contractId: string }) {
  const t = useTranslations("Maintenance");
  const action = useAction();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(() => cancelContractAction(contractId, reason));
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <Field id="cancel-reason" label={t("cancelReason")} hint={t("cancelHint")}>
        <Input
          id="cancel-reason"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={action.pending || !reason.trim()}>
          {t("cancelContract")}
        </Button>
      </div>
    </form>
  );
}

/** Raises the reminders that are due right now (the worker does the same on a timer). */
export function GenerateReminders() {
  const t = useTranslations("Maintenance");
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      {result ? <Alert variant="success">{result}</Alert> : null}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
          onClick={() =>
            action.run(async () => {
              const r = await generateRemindersAction();
              if (r.ok)
                setResult(t("remindersResult", { created: r.created, existing: r.alreadyRaised }));
              return r;
            })
          }
        >
          {t("generateReminders")}
        </Button>
      </div>
    </div>
  );
}
