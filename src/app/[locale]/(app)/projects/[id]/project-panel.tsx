"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/projects/use-action";
import type { StaffVM } from "@/components/projects/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { ProjectStatus } from "@/modules/projects/rules";
import { changeProjectStatusAction, recordHandoverAction, updateProjectAction } from "../actions";

interface Props {
  projectId: string;
  status: ProjectStatus;
  title: string;
  managerId: string | null;
  startDate: string;
  targetDate: string;
  rollbackPlan: string;
  handoverNotes: string | null;
  staff: StaffVM[];
  canManage: boolean;
  nextStatuses: ProjectStatus[];
  /** Why each next status is currently blocked (empty array = allowed). */
  blockers: Record<string, string[]>;
  closed: boolean;
}

/** Plan, status changes and handover. Only people who manage projects see the controls. */
export function ProjectPanel(props: Props) {
  const t = useTranslations("Projects");
  const tStatus = useTranslations("Projects.status");
  const tBlock = useTranslations("Projects.blockers");
  const edit = useAction();
  const move = useAction();
  const handover = useAction();
  const [title, setTitle] = useState(props.title);
  const [managerId, setManagerId] = useState(props.managerId ?? "");
  const [startDate, setStartDate] = useState(props.startDate);
  const [targetDate, setTargetDate] = useState(props.targetDate);
  const [plan, setPlan] = useState(props.rollbackPlan);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const readOnly = !props.canManage || props.closed;

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          edit.run(
            () =>
              updateProjectAction(props.projectId, {
                title,
                managerId,
                startDate,
                targetDate,
                rollbackPlan: plan,
              }),
            () => setSaved(true),
          );
        }}
      >
        {edit.error ? <Alert variant="danger">{edit.error}</Alert> : null}
        {saved ? <Alert variant="success">{t("saved")}</Alert> : null}
        <Field id="project-title" label={t("col.title")}>
          <Input
            id="project-title"
            required
            maxLength={200}
            value={title}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="project-manager" label={t("manager")}>
            <Select
              id="project-manager"
              value={managerId}
              disabled={readOnly}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">{t("unassigned")}</option>
              {props.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="project-start" label={t("startDate")}>
            <Input
              id="project-start"
              type="date"
              dir="ltr"
              value={startDate}
              disabled={readOnly}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field id="project-target" label={t("targetDate")}>
            <Input
              id="project-target"
              type="date"
              dir="ltr"
              value={targetDate}
              disabled={readOnly}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </Field>
        </div>
        <Field id="project-rollback" label={t("rollbackPlan")} hint={t("rollbackHint")}>
          <Textarea
            id="project-rollback"
            maxLength={4000}
            value={plan}
            disabled={readOnly}
            onChange={(e) => setPlan(e.target.value)}
          />
        </Field>
        {!readOnly ? (
          <div>
            <Button type="submit" disabled={edit.pending || title.trim() === ""}>
              {t("savePlan")}
            </Button>
          </div>
        ) : null}
      </form>

      {props.canManage && !props.closed ? (
        <section aria-labelledby="status-heading" className="flex flex-col gap-3">
          <h3 id="status-heading" className="font-semibold">
            {t("changeStatus")}
          </h3>
          {move.error ? <Alert variant="danger">{move.error}</Alert> : null}
          <ul className="flex flex-col gap-2">
            {props.nextStatuses.map((to) => {
              const blocked = props.blockers[to] ?? [];
              const needsReason = to === "cancelled";
              return (
                <li key={to} className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant={to === "cancelled" ? "outline" : "default"}
                    disabled={move.pending || blocked.length > 0 || (needsReason && !reason.trim())}
                    onClick={() =>
                      move.run(() =>
                        changeProjectStatusAction(props.projectId, {
                          to,
                          reason: needsReason ? reason : undefined,
                        }),
                      )
                    }
                  >
                    {t("moveTo", { status: tStatus(to) })}
                  </Button>
                  {blocked.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {blocked.map((b) => tBlock(b as "TASKS_OPEN")).join(" · ")}
                    </span>
                  ) : null}
                  {needsReason ? (
                    <Input
                      aria-label={t("cancelReason")}
                      placeholder={t("cancelReason")}
                      maxLength={300}
                      className="max-w-xs"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="handover-heading" className="flex flex-col gap-3">
        <h3 id="handover-heading" className="font-semibold">
          {t("handover")}
        </h3>
        {props.handoverNotes ? (
          <p className="text-sm whitespace-pre-wrap">{props.handoverNotes}</p>
        ) : props.canManage && !props.closed && props.status === "in_progress" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              handover.run(() => recordHandoverAction(props.projectId, { notes }));
            }}
          >
            {handover.error ? <Alert variant="danger">{handover.error}</Alert> : null}
            <Field id="handover-notes" label={t("handoverNotes")} hint={t("handoverHint")}>
              <Textarea
                id="handover-notes"
                required
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" disabled={handover.pending || notes.trim() === ""}>
                {t("recordHandover")}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noHandover")}</p>
        )}
      </section>
    </div>
  );
}
