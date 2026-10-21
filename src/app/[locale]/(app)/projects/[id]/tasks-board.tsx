"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useState } from "react";
import { TaskStatusBadge } from "@/components/projects/badges";
import type { MilestoneVM, StaffVM, TaskVM } from "@/components/projects/types";
import { useAction } from "@/components/projects/use-action";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { allowedNextTaskStatuses, type TaskStatus } from "@/modules/projects/rules";
import {
  addChecklistItemAction,
  addDependencyAction,
  changeTaskStatusAction,
  createMilestoneAction,
  createTaskAction,
  deleteChecklistItemAction,
  deleteMilestoneAction,
  deleteTaskAction,
  removeDependencyAction,
  setChecklistItemDoneAction,
  updateMilestoneAction,
  updateTaskAction,
} from "../actions";

interface Props {
  projectId: string;
  tasks: TaskVM[];
  milestones: MilestoneVM[];
  staff: StaffVM[];
  /** Can the current user change tasks, and is the project still open for changes. */
  editable: boolean;
}

export function TasksBoard({ projectId, tasks, milestones, staff, editable }: Props) {
  const t = useTranslations("Projects");
  const titleOf = new Map(tasks.map((task) => [task.id, task.title]));

  return (
    <div className="flex flex-col gap-8">
      <MilestonesSection projectId={projectId} milestones={milestones} editable={editable} />

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-4">
        <h3 id="tasks-heading" className="text-lg font-semibold">
          {t("tasks")}
        </h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                number={index + 1}
                task={task}
                allTasks={tasks}
                titleOf={titleOf}
                milestones={milestones}
                staff={staff}
                editable={editable}
              />
            ))}
          </ol>
        )}
        {editable ? <NewTask projectId={projectId} milestones={milestones} staff={staff} /> : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function TaskCard({
  number,
  task,
  allTasks,
  titleOf,
  milestones,
  staff,
  editable,
}: {
  number: number;
  task: TaskVM;
  allTasks: TaskVM[];
  titleOf: Map<string, string>;
  milestones: MilestoneVM[];
  staff: StaffVM[];
  editable: boolean;
}) {
  const t = useTranslations("Projects");
  const tKind = useTranslations("Projects.taskKind");
  const tStatus = useTranslations("Projects.taskStatus");
  const tBlock = useTranslations("Projects.blockers");
  const action = useAction();
  // Checking a box responds at once; the server's answer replaces it when the page refreshes.
  const [checklist, setChecklistOptimistic] = useOptimistic(
    task.checklist,
    (items, change: { id: string; done: boolean }) =>
      items.map((item) => (item.id === change.id ? { ...item, done: change.done } : item)),
  );
  const [newItem, setNewItem] = useState("");
  const [dependency, setDependency] = useState("");
  const [editing, setEditing] = useState(false);

  const next = allowedNextTaskStatuses(task.status);
  const blockersFor = (to: TaskStatus) =>
    to === "in_progress" ? task.blockers.start : to === "done" ? task.blockers.finish : [];
  const candidates = allTasks.filter((o) => o.id !== task.id && !task.dependsOn.includes(o.id));
  const label = `${number}. ${task.title}`;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="font-semibold">{label}</h4>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <TaskStatusBadge status={task.status} />
            <Badge>{tKind(task.kind)}</Badge>
            <span>{task.assigneeName ?? t("unassigned")}</span>
            {task.dueDate ? (
              <span dir="ltr">
                {t("due")}: {task.dueDate}
              </span>
            ) : null}
          </div>
        </div>
        {editable ? (
          <ul
            className="flex flex-wrap items-center gap-2"
            aria-label={`${label}: ${t("moveTaskTo")}`}
          >
            {next.map((to) => {
              const blocked = blockersFor(to);
              return (
                <li key={to}>
                  <Button
                    type="button"
                    size="sm"
                    variant={to === "done" ? "default" : "outline"}
                    disabled={action.pending || blocked.length > 0}
                    aria-label={`${label}: ${t("moveTo", { status: tStatus(to) })}`}
                    onClick={() => action.run(() => changeTaskStatusAction(task.id, to))}
                  >
                    {tStatus(to)}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      {editable && task.status !== "done" && task.status !== "cancelled" ? (
        <BlockerHint start={task.blockers.start} finish={task.blockers.finish} tBlock={tBlock} />
      ) : null}
      {task.description ? <p className="text-sm whitespace-pre-wrap">{task.description}</p> : null}

      <div className="flex flex-col gap-1">
        <h5 className="text-sm font-medium">{t("checklist")}</h5>
        {checklist.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noChecklist")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!editable || task.status === "done" || action.pending}
                  aria-label={item.text}
                  onChange={(e) => {
                    const done = e.target.checked;
                    action.run(async () => {
                      setChecklistOptimistic({ id: item.id, done });
                      return setChecklistItemDoneAction(item.id, done);
                    });
                  }}
                />
                <span className={item.done ? "text-muted-foreground line-through" : ""}>
                  {item.text}
                </span>
                {editable && task.status !== "done" ? (
                  <button
                    type="button"
                    className="ms-auto text-muted-foreground hover:text-danger"
                    aria-label={`${t("removeItem")}: ${item.text}`}
                    onClick={() => action.run(() => deleteChecklistItemAction(item.id))}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable && task.status !== "done" ? (
          <form
            className="mt-1 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              action.run(
                () => addChecklistItemAction(task.id, newItem),
                () => setNewItem(""),
              );
            }}
          >
            <Input
              aria-label={`${label}: ${t("addItem")}`}
              placeholder={t("addItem")}
              maxLength={300}
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={action.pending || !newItem.trim()}
            >
              {t("add")}
            </Button>
          </form>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <h5 className="text-sm font-medium">{t("dependsOn")}</h5>
        {task.dependsOn.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noDependencies")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {task.dependsOn.map((id) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span>{titleOf.get(id)}</span>
                {editable ? (
                  <button
                    type="button"
                    className="ms-auto text-muted-foreground hover:text-danger"
                    aria-label={`${t("removeDependency")}: ${titleOf.get(id)}`}
                    onClick={() => action.run(() => removeDependencyAction(task.id, id))}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable && candidates.length > 0 ? (
          <div className="mt-1 flex gap-2">
            <Select
              aria-label={`${label}: ${t("addDependency")}`}
              value={dependency}
              onChange={(e) => setDependency(e.target.value)}
            >
              <option value="">{t("addDependency")}</option>
              {candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={action.pending || !dependency}
              aria-label={`${label}: ${t("link")}`}
              onClick={() =>
                action.run(
                  () => addDependencyAction(task.id, dependency),
                  () => setDependency(""),
                )
              }
            >
              {t("link")}
            </Button>
          </div>
        ) : null}
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {t("editTask")}
          </Button>
          {task.status === "todo" || task.status === "cancelled" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={action.pending}
              aria-label={`${label}: ${t("deleteTask")}`}
              onClick={() => action.run(() => deleteTaskAction(task.id))}
            >
              {t("deleteTask")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <TaskForm
          initial={task}
          milestones={milestones}
          staff={staff}
          submitLabel={t("saveTask")}
          onSubmit={(values) =>
            action.run(
              () => updateTaskAction(task.id, values),
              () => setEditing(false),
            )
          }
          pending={action.pending}
          idPrefix={`edit-${task.id}`}
        />
      ) : null}
    </li>
  );
}

function BlockerHint({
  start,
  finish,
  tBlock,
}: {
  start: string[];
  finish: string[];
  tBlock: (key: "DEPENDENCY_OPEN" | "CHECKLIST_OPEN") => string;
}) {
  const reasons = [...new Set([...start, ...finish])] as ("DEPENDENCY_OPEN" | "CHECKLIST_OPEN")[];
  if (reasons.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">{reasons.map((r) => tBlock(r)).join(" · ")}</p>
  );
}

// ---------------------------------------------------------------------------------------------

function TaskForm({
  initial,
  milestones,
  staff,
  submitLabel,
  onSubmit,
  pending,
  idPrefix,
}: {
  initial?: Pick<TaskVM, "title" | "description" | "assigneeId" | "milestoneId" | "dueDate">;
  milestones: MilestoneVM[];
  staff: StaffVM[];
  submitLabel: string;
  onSubmit: (values: {
    title: string;
    description: string;
    assigneeId: string;
    milestoneId: string;
    dueDate: string;
  }) => void;
  pending: boolean;
  idPrefix: string;
}) {
  const t = useTranslations("Projects");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? "");
  const [milestoneId, setMilestoneId] = useState(initial?.milestoneId ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ title, description, assigneeId, milestoneId, dueDate });
        if (!initial) {
          setTitle("");
          setDescription("");
          setDueDate("");
        }
      }}
    >
      <Field id={`${idPrefix}-title`} label={t("taskTitle")}>
        <Input
          id={`${idPrefix}-title`}
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field id={`${idPrefix}-description`} label={t("taskDescription")}>
        <Textarea
          id={`${idPrefix}-description`}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${idPrefix}-assignee`} label={t("assignee")}>
          <Select
            id={`${idPrefix}-assignee`}
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
        <Field id={`${idPrefix}-milestone`} label={t("milestone")}>
          <Select
            id={`${idPrefix}-milestone`}
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
          >
            <option value="">{t("noMilestone")}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${idPrefix}-due`} label={t("dueDate")}>
          <Input
            id={`${idPrefix}-due`}
            type="date"
            dir="ltr"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function NewTask({
  projectId,
  milestones,
  staff,
}: {
  projectId: string;
  milestones: MilestoneVM[];
  staff: StaffVM[];
}) {
  const t = useTranslations("Projects");
  const action = useAction();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <div>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t("addTask")}
        </Button>
      </div>
      {open ? (
        <TaskForm
          milestones={milestones}
          staff={staff}
          submitLabel={t("createTask")}
          pending={action.pending}
          idPrefix="new-task"
          onSubmit={(values) =>
            action.run(
              () => createTaskAction(projectId, values),
              () => setOpen(false),
            )
          }
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function MilestonesSection({
  projectId,
  milestones,
  editable,
}: {
  projectId: string;
  milestones: MilestoneVM[];
  editable: boolean;
}) {
  const t = useTranslations("Projects");
  const action = useAction();
  const [shown, setShownOptimistic] = useOptimistic(
    milestones,
    (items, change: { id: string; done: boolean }) =>
      items.map((m) => (m.id === change.id ? { ...m, done: change.done } : m)),
  );
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  return (
    <section aria-labelledby="milestones-heading" className="flex flex-col gap-3">
      <h3 id="milestones-heading" className="text-lg font-semibold">
        {t("milestones")}
      </h3>
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={m.done}
                disabled={!editable || action.pending}
                aria-label={m.title}
                onChange={(e) => {
                  const done = e.target.checked;
                  action.run(async () => {
                    setShownOptimistic({ id: m.id, done });
                    return updateMilestoneAction(m.id, {
                      title: m.title,
                      dueDate: m.dueDate ?? "",
                      done,
                    });
                  });
                }}
              />
              <span className={m.done ? "text-muted-foreground line-through" : "font-medium"}>
                {m.title}
              </span>
              {m.dueDate ? (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {m.dueDate}
                </span>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  className="ms-auto text-muted-foreground hover:text-danger"
                  aria-label={`${t("removeMilestone")}: ${m.title}`}
                  onClick={() => action.run(() => deleteMilestoneAction(m.id))}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.run(
              () => createMilestoneAction(projectId, { title, dueDate }),
              () => {
                setTitle("");
                setDueDate("");
              },
            );
          }}
        >
          <div className="min-w-56 flex-1">
            <Field id="milestone-title" label={t("milestoneTitle")}>
              <Input
                id="milestone-title"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
          </div>
          <Field id="milestone-due" label={t("dueDate")}>
            <Input
              id="milestone-due"
              type="date"
              dir="ltr"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={action.pending || !title.trim()}>
            {t("addMilestone")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
