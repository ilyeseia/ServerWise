"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  addCommentAction,
  changeTicketStatusAction,
  recordServiceReportAction,
  updateTicketAction,
} from "@/app/[locale]/(app)/care-actions";
import { useAction } from "@/components/projects/use-action";
import type { StaffVM } from "@/components/projects/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TICKET_PRIORITIES, type TicketPriority, type TicketStatus } from "@/modules/careops/rules";

interface Props {
  ticketId: string;
  status: TicketStatus;
  nextStatuses: TicketStatus[];
  resolution: string;
  title: string;
  description: string;
  priority: TicketPriority;
  assigneeId: string;
  staff: StaffVM[];
  canWrite: boolean;
  canPerform: boolean;
}

/** Status moves, discussion, edits and visit reports for one ticket. */
export function TicketControls(props: Props) {
  const t = useTranslations("Tickets");
  const tStatus = useTranslations("Tickets.status");
  const tPriority = useTranslations("Tickets.priority");
  const tVisit = useTranslations("Maintenance");
  const move = useAction();
  const comment = useAction();
  const edit = useAction();
  const visit = useAction();
  const [resolution, setResolution] = useState(props.resolution);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState(props.title);
  const [description, setDescription] = useState(props.description);
  const [priority, setPriority] = useState(props.priority);
  const [assigneeId, setAssigneeId] = useState(props.assigneeId);
  const [summary, setSummary] = useState("");
  const [parts, setParts] = useState("");
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 10));
  const closed = props.status === "closed";

  return (
    <div className="flex flex-col gap-8">
      {props.canWrite && !closed ? (
        <section aria-labelledby="move-heading" className="flex flex-col gap-3">
          <h3 id="move-heading" className="font-semibold">
            {t("changeStatus")}
          </h3>
          {move.error ? <Alert variant="danger">{move.error}</Alert> : null}
          {props.nextStatuses.includes("resolved") ? (
            <Field id="ticket-resolution" label={t("resolution")} hint={t("resolutionHint")}>
              <Textarea
                id="ticket-resolution"
                maxLength={2000}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </Field>
          ) : null}
          <ul className="flex flex-wrap gap-2">
            {props.nextStatuses.map((to) => (
              <li key={to}>
                <Button
                  type="button"
                  variant={to === "resolved" ? "default" : "outline"}
                  disabled={move.pending || (to === "resolved" && !resolution.trim())}
                  onClick={() =>
                    move.run(() =>
                      changeTicketStatusAction(props.ticketId, {
                        to,
                        resolution: to === "resolved" ? resolution : undefined,
                      }),
                    )
                  }
                >
                  {t("moveTo", { status: tStatus(to) })}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.canWrite && !closed ? (
        <section aria-labelledby="comment-heading" className="flex flex-col gap-3">
          <h3 id="comment-heading" className="font-semibold">
            {t("addComment")}
          </h3>
          {comment.error ? <Alert variant="danger">{comment.error}</Alert> : null}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              comment.run(
                () => addCommentAction(props.ticketId, body),
                () => setBody(""),
              );
            }}
          >
            <Field id="ticket-comment" label={t("comment")}>
              <Textarea
                id="ticket-comment"
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" variant="outline" disabled={comment.pending || !body.trim()}>
                {t("post")}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {props.canPerform && !closed ? (
        <section aria-labelledby="visit-heading" className="flex flex-col gap-3">
          <h3 id="visit-heading" className="font-semibold">
            {tVisit("recordVisit")}
          </h3>
          {visit.error ? <Alert variant="danger">{visit.error}</Alert> : null}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              visit.run(
                () =>
                  recordServiceReportAction({
                    ticketId: props.ticketId,
                    performedAt,
                    summary,
                    partsReplaced: parts,
                  }),
                () => {
                  setSummary("");
                  setParts("");
                },
              );
            }}
          >
            <Field id="visit-date" label={tVisit("performedAt")}>
              <Input
                id="visit-date"
                type="date"
                dir="ltr"
                required
                value={performedAt}
                onChange={(e) => setPerformedAt(e.target.value)}
              />
            </Field>
            <Field id="visit-summary" label={tVisit("summary")}>
              <Textarea
                id="visit-summary"
                required
                maxLength={2000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
            <Field id="visit-parts" label={tVisit("partsReplaced")}>
              <Input
                id="visit-parts"
                maxLength={1000}
                value={parts}
                onChange={(e) => setParts(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" variant="outline" disabled={visit.pending || !summary.trim()}>
                {tVisit("saveVisit")}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {props.canWrite && !closed ? (
        <section aria-labelledby="edit-heading" className="flex flex-col gap-3">
          <h3 id="edit-heading" className="font-semibold">
            {t("edit")}
          </h3>
          {edit.error ? <Alert variant="danger">{edit.error}</Alert> : null}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              edit.run(() =>
                updateTicketAction(props.ticketId, { title, description, priority, assigneeId }),
              );
            }}
          >
            <Field id="edit-title" label={t("titleLabel")}>
              <Input
                id="edit-title"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field id="edit-description" label={t("description")}>
              <Textarea
                id="edit-description"
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="edit-priority" label={t("priorityLabel")}>
                <Select
                  id="edit-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="edit-assignee" label={t("assignee")}>
                <Select
                  id="edit-assignee"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">{t("unassigned")}</option>
                  {props.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={edit.pending || !title.trim()}>
                {t("saveChanges")}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
