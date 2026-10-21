import type { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError, type Actor } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import {
  allowedNextProjectStatuses,
  buildInitialTasks,
  canTransitionProject,
  canTransitionTask,
  isProjectClosed,
  projectBlockers,
  taskBlockers,
  wouldCreateCycle,
  type ProjectStatus,
  type TaskBlocker,
  type TaskStatus,
  type TemplateLocale,
} from "./rules";
import {
  checklistTextInput,
  handoverInput,
  milestoneInput,
  projectStatusInput,
  projectUpdateInput,
  taskInput,
  taskStatusInput,
  type HandoverInput,
  type MilestoneInput,
  type ProjectStatusInput,
  type ProjectUpdateInput,
  type TaskInput,
} from "./schemas";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

async function nextProjectNumber(tx: Tx, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "project_counter" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "project_counter"."last" + 1
    RETURNING "last"`;
  return `P-${year}-${String(rows[0]!.last).padStart(4, "0")}`;
}

/** Loads a project that is still open for changes. */
async function openProject(tx: Tx, projectId: string) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project");
  if (isProjectClosed(project.status)) {
    throw new RuleViolationError("PROJECT_CLOSED", "The project is finished and cannot change");
  }
  return project;
}

/** Task work happens while the project is planned or in progress, not while it is paused. */
function assertWorkAllowed(status: ProjectStatus) {
  if (status === "on_hold") {
    throw new RuleViolationError("PROJECT_ON_HOLD", "Resume the project before changing tasks");
  }
}

/** Only active staff who work on projects can be assigned. */
async function assertStaff(tx: Tx, userId: string | undefined) {
  if (!userId) return;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, banned: true },
  });
  if (!user || user.banned || !can(user.role, "project:write")) {
    throw new RuleViolationError("INVALID_ASSIGNEE", "The selected person cannot be assigned");
  }
}

const audit = (
  tx: Tx,
  ctx: CrmContext,
  actor: Actor,
  action: Parameters<typeof auditData>[1],
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonValue,
) =>
  tx.auditLog.create({
    data: auditData(actor, action, entityType, entityId, metadata, ctx.client),
  });

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface ProjectListItem {
  id: string;
  number: string;
  title: string;
  status: ProjectStatus;
  leadId: string;
  customerId: string;
  customerName: string;
  quoteNumber: string;
  targetDate: Date | null;
  tasksDone: number;
  tasksTotal: number;
  createdAt: Date;
}

/** Cancelled tasks are no longer expected, so they do not count towards progress. */
function progressOf(tasks: readonly { status: TaskStatus }[]) {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const done = counted.filter((task) => task.status === "done").length;
  return {
    done,
    total: counted.length,
    percent: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100),
  };
}

export async function listProjects(
  ctx: CrmContext,
  query: { status?: ProjectStatus; page?: number; pageSize?: number } = {},
): Promise<Page<ProjectListItem>> {
  assertCan(ctx.actor, "project:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const where: Prisma.ProjectWhereInput = query.status ? { status: query.status } : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        quote: { select: { number: true } },
        lead: { select: { customer: { select: { id: true, name: true } } } },
        tasks: { select: { status: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((project) => {
      const progress = progressOf(project.tasks);
      return {
        id: project.id,
        number: project.number,
        title: project.title,
        status: project.status,
        leadId: project.leadId,
        customerId: project.lead.customer.id,
        customerName: project.lead.customer.name,
        quoteNumber: project.quote.number,
        targetDate: project.targetDate,
        tasksDone: progress.done,
        tasksTotal: progress.total,
        createdAt: project.createdAt,
      };
    }),
  };
}

export async function getProject(ctx: CrmContext, id: string) {
  assertCan(ctx.actor, "project:read");
  const project = await getDb().project.findUnique({
    where: { id },
    include: {
      quote: { select: { id: true, number: true } },
      lead: {
        select: { id: true, title: true, customer: { select: { id: true, name: true } } },
      },
      manager: { select: { id: true, name: true } },
      milestones: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      tasks: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: {
          assignee: { select: { id: true, name: true } },
          checklist: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          dependsOn: { select: { dependsOnId: true } },
        },
      },
    },
  });
  if (!project) throw notFound("Project");

  const statusById = new Map(project.tasks.map((task) => [task.id, task.status]));
  const tasks = project.tasks.map((task) => {
    const facts = {
      dependencyStatuses: task.dependsOn.map((d) => statusById.get(d.dependsOnId)!),
      checklist: task.checklist,
    };
    return {
      id: task.id,
      kind: task.kind,
      title: task.title,
      description: task.description,
      status: task.status,
      assigneeId: task.assigneeId,
      assigneeName: task.assignee?.name ?? null,
      dueDate: task.dueDate,
      milestoneId: task.milestoneId,
      position: task.position,
      completedAt: task.completedAt,
      dependsOn: task.dependsOn.map((d) => d.dependsOnId),
      checklist: task.checklist.map((item) => ({
        id: item.id,
        text: item.text,
        done: item.done,
        position: item.position,
      })),
      /** Why the task cannot start / be finished right now (empty = it can). */
      blockers: {
        start: taskBlockers("in_progress", facts) as TaskBlocker[],
        finish: taskBlockers("done", facts) as TaskBlocker[],
      },
    };
  });

  return {
    id: project.id,
    number: project.number,
    title: project.title,
    status: project.status,
    managerId: project.managerId,
    managerName: project.manager?.name ?? null,
    startDate: project.startDate,
    targetDate: project.targetDate,
    rollbackPlan: project.rollbackPlan,
    handoverNotes: project.handoverNotes,
    handoverAt: project.handoverAt,
    completedAt: project.completedAt,
    cancelReason: project.cancelReason,
    createdAt: project.createdAt,
    quote: project.quote,
    lead: project.lead,
    milestones: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      dueDate: m.dueDate,
      position: m.position,
      doneAt: m.doneAt,
    })),
    tasks,
    progress: progressOf(tasks),
    nextStatuses: allowedNextProjectStatuses(project.status),
    blockersFor: Object.fromEntries(
      allowedNextProjectStatuses(project.status).map((to) => [
        to,
        projectBlockers(to, {
          rollbackPlan: project.rollbackPlan,
          handoverRecorded: project.handoverAt !== null,
          tasks,
        }),
      ]),
    ) as Record<string, string[]>,
  };
}

/** Active staff who can be given project work. */
export async function listProjectStaff(ctx: CrmContext) {
  assertCan(ctx.actor, "project:read");
  const users = await getDb().user.findMany({
    where: { banned: { not: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users.filter((u) => can(u.role, "project:write")).map(({ id, name }) => ({ id, name }));
}

/** The project created from a quotation, if any (for the "create project" button). */
export async function findProjectForQuote(ctx: CrmContext, quoteId: string) {
  assertCan(ctx.actor, "project:read");
  return getDb().project.findUnique({
    where: { quoteId },
    select: { id: true, number: true },
  });
}

// ---------------------------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * Creates the project for an accepted quotation, exactly once. Asking again (a double click, a
 * retry, two people at the same time) returns the existing project instead of a duplicate: the
 * unique quotation reference in the database is the guarantee, not this check.
 */
export async function createProjectFromQuote(
  ctx: CrmContext,
  quoteId: string,
  locale: TemplateLocale,
  now = new Date(),
): Promise<{ id: string; number: string; created: boolean }> {
  assertCan(ctx.actor, "project:manage");
  assertCan(ctx.actor, "quote:read");
  const actor = ctx.actor;
  const db = getDb();

  const existing = () =>
    db.project.findUnique({ where: { quoteId }, select: { id: true, number: true } });

  const found = await existing();
  if (found) return { ...found, created: false };

  try {
    return await db.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: quoteId },
        include: {
          revisions: {
            where: { status: "accepted" },
            include: { lines: { orderBy: { position: "asc" } } },
          },
        },
      });
      if (!quote) throw notFound("Quote");
      const accepted = quote.revisions[0];
      if (!accepted) {
        throw new RuleViolationError("QUOTE_NOT_ACCEPTED", "The quotation has not been accepted");
      }

      const number = await nextProjectNumber(tx, now);
      const project = await tx.project.create({
        data: {
          number,
          quoteId,
          leadId: quote.leadId,
          title: quote.title,
          managerId: actor.id,
          createdById: actor.id,
        },
      });

      const template = buildInitialTasks(accepted.lines, locale);
      const ids: string[] = [];
      for (const [position, item] of template.entries()) {
        const task = await tx.task.create({
          data: {
            projectId: project.id,
            kind: item.kind,
            title: item.title,
            position,
            checklist: {
              create: item.checklist.map((text, index) => ({ text, position: index })),
            },
          },
        });
        ids.push(task.id);
      }
      const edges = template.flatMap((item, index) =>
        item.dependsOn.map((dependency) => ({
          taskId: ids[index]!,
          dependsOnId: ids[dependency]!,
        })),
      );
      for (const edge of edges) await tx.taskDependency.create({ data: edge });

      await audit(tx, ctx, actor, "project.created", "project", project.id, {
        number,
        quoteId,
        tasks: ids.length,
      });
      return { id: project.id, number, created: true };
    });
  } catch (error) {
    // Lost a race with another request for the same quotation: return the winner's project.
    const winner = await existing();
    if (winner) return { ...winner, created: false };
    throw error;
  }
}

export async function updateProject(ctx: CrmContext, id: string, input: ProjectUpdateInput) {
  assertCan(ctx.actor, "project:manage");
  const actor = ctx.actor;
  const data = projectUpdateInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const project = await openProject(tx, id);
    await assertStaff(tx, data.managerId);
    // The plan of a project that already started can be improved but not erased.
    if (project.status !== "planned" && !data.rollbackPlan) {
      throw new RuleViolationError("ROLLBACK_PLAN_REQUIRED", "A rollback plan is required");
    }
    await tx.project.update({
      where: { id },
      data: {
        title: data.title,
        managerId: orNull(data.managerId),
        startDate: orNull(data.startDate),
        targetDate: orNull(data.targetDate),
        rollbackPlan: orNull(data.rollbackPlan),
      },
    });
    await audit(tx, ctx, actor, "project.updated", "project", id, {});
    return { id };
  });
}

export async function changeProjectStatus(
  ctx: CrmContext,
  id: string,
  input: ProjectStatusInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "project:manage");
  const actor = ctx.actor;
  const { to, reason } = projectStatusInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      include: { tasks: { select: { status: true } } },
    });
    if (!project) throw notFound("Project");
    if (!canTransitionProject(project.status, to)) {
      throw new RuleViolationError(
        "INVALID_TRANSITION",
        `A ${project.status} project cannot become ${to}`,
      );
    }
    if (to === "cancelled" && !reason) {
      throw new RuleViolationError("CANCEL_REASON_REQUIRED", "Say why the project is cancelled");
    }
    const [blocker] = projectBlockers(to, {
      rollbackPlan: project.rollbackPlan,
      handoverRecorded: project.handoverAt !== null,
      tasks: project.tasks,
    });
    if (blocker) throw new RuleViolationError(blocker, `The project cannot become ${to}`);

    await tx.project.update({
      where: { id },
      data: {
        status: to,
        completedAt: to === "completed" ? now : null,
        cancelReason: to === "cancelled" ? reason : null,
      },
    });
    await audit(tx, ctx, actor, "project.status_changed", "project", id, {
      from: project.status,
      to,
    });
    return { status: to };
  });
}

/** Records the handover. It is a written record, so the project must be under way. */
export async function recordHandover(
  ctx: CrmContext,
  id: string,
  input: HandoverInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "project:manage");
  const actor = ctx.actor;
  const data = handoverInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const project = await openProject(tx, id);
    if (project.status !== "in_progress") {
      throw new RuleViolationError("HANDOVER_NOT_ALLOWED", "The project must be in progress");
    }
    await tx.project.update({
      where: { id },
      data: { handoverNotes: data.notes, handoverAt: now, handoverById: actor.id },
    });
    await audit(tx, ctx, actor, "project.handover_recorded", "project", id, {});
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------

export async function createMilestone(ctx: CrmContext, projectId: string, input: MilestoneInput) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const data = milestoneInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    await openProject(tx, projectId);
    const last = await tx.milestone.aggregate({ where: { projectId }, _max: { position: true } });
    const milestone = await tx.milestone.create({
      data: {
        projectId,
        title: data.title,
        dueDate: orNull(data.dueDate),
        position: (last._max.position ?? -1) + 1,
      },
    });
    await audit(tx, ctx, actor, "milestone.created", "milestone", milestone.id, { projectId });
    return { id: milestone.id };
  });
}

export async function updateMilestone(
  ctx: CrmContext,
  milestoneId: string,
  input: MilestoneInput & { done?: boolean },
  now = new Date(),
) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const data = milestoneInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const milestone = await tx.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone) throw notFound("Milestone");
    await openProject(tx, milestone.projectId);
    await tx.milestone.update({
      where: { id: milestoneId },
      data: {
        title: data.title,
        dueDate: orNull(data.dueDate),
        ...(input.done === undefined
          ? {}
          : { doneAt: input.done ? (milestone.doneAt ?? now) : null }),
      },
    });
    await audit(tx, ctx, actor, "milestone.updated", "milestone", milestoneId, {
      projectId: milestone.projectId,
    });
    return { id: milestoneId };
  });
}

export async function deleteMilestone(ctx: CrmContext, milestoneId: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const milestone = await tx.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone) throw notFound("Milestone");
    await openProject(tx, milestone.projectId);
    await tx.milestone.delete({ where: { id: milestoneId } }); // its tasks keep existing (SetNull)
    await audit(tx, ctx, actor, "milestone.deleted", "milestone", milestoneId, {
      projectId: milestone.projectId,
    });
    return { id: milestoneId };
  });
}

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

async function assertMilestoneInProject(
  tx: Tx,
  milestoneId: string | undefined,
  projectId: string,
) {
  if (!milestoneId) return;
  const milestone = await tx.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone || milestone.projectId !== projectId) {
    throw new RuleViolationError("MILESTONE_MISMATCH", "The milestone belongs to another project");
  }
}

export async function createTask(ctx: CrmContext, projectId: string, input: TaskInput) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const data = taskInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    await openProject(tx, projectId);
    await assertStaff(tx, data.assigneeId);
    await assertMilestoneInProject(tx, data.milestoneId, projectId);
    const last = await tx.task.aggregate({ where: { projectId }, _max: { position: true } });
    const task = await tx.task.create({
      data: {
        projectId,
        title: data.title,
        description: orNull(data.description),
        milestoneId: orNull(data.milestoneId),
        assigneeId: orNull(data.assigneeId),
        dueDate: orNull(data.dueDate),
        position: (last._max.position ?? -1) + 1,
      },
    });
    await audit(tx, ctx, actor, "task.created", "task", task.id, { projectId });
    return { id: task.id };
  });
}

export async function updateTask(ctx: CrmContext, taskId: string, input: TaskInput) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const data = taskInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound("Task");
    await openProject(tx, task.projectId);
    await assertStaff(tx, data.assigneeId);
    await assertMilestoneInProject(tx, data.milestoneId, task.projectId);
    await tx.task.update({
      where: { id: taskId },
      data: {
        title: data.title,
        description: orNull(data.description),
        milestoneId: orNull(data.milestoneId),
        assigneeId: orNull(data.assigneeId),
        dueDate: orNull(data.dueDate),
      },
    });
    await audit(tx, ctx, actor, "task.updated", "task", taskId, { projectId: task.projectId });
    return { id: taskId };
  });
}

export async function changeTaskStatus(
  ctx: CrmContext,
  taskId: string,
  to: TaskStatus,
  now = new Date(),
) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const next = taskStatusInput.parse(to);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
        checklist: { select: { done: true } },
        dependsOn: { select: { dependsOn: { select: { status: true } } } },
      },
    });
    if (!task) throw notFound("Task");
    const project = await openProject(tx, task.projectId);
    assertWorkAllowed(project.status);

    if (!canTransitionTask(task.status, next)) {
      throw new RuleViolationError(
        "INVALID_TRANSITION",
        `A ${task.status} task cannot become ${next}`,
      );
    }
    const [blocker] = taskBlockers(next, {
      dependencyStatuses: task.dependsOn.map((d) => d.dependsOn.status),
      checklist: task.checklist,
    });
    if (blocker) throw new RuleViolationError(blocker, `The task cannot become ${next}`);

    await tx.task.update({
      where: { id: taskId },
      data: { status: next, completedAt: next === "done" ? now : null },
    });
    await audit(tx, ctx, actor, "task.status_changed", "task", taskId, {
      projectId: task.projectId,
      from: task.status,
      to: next,
    });
    return { status: next };
  });
}

export async function deleteTask(ctx: CrmContext, taskId: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound("Task");
    await openProject(tx, task.projectId);
    if (task.status !== "todo" && task.status !== "cancelled") {
      throw new RuleViolationError(
        "TASK_NOT_DELETABLE",
        "Only a task that has not started can be deleted; cancel it instead",
      );
    }
    await tx.task.delete({ where: { id: taskId } });
    await audit(tx, ctx, actor, "task.deleted", "task", taskId, { projectId: task.projectId });
    return { id: taskId };
  });
}

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export async function addDependency(ctx: CrmContext, taskId: string, dependsOnId: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const [task, prerequisite] = await Promise.all([
      tx.task.findUnique({ where: { id: taskId } }),
      tx.task.findUnique({ where: { id: dependsOnId } }),
    ]);
    if (!task || !prerequisite) throw notFound("Task");
    if (task.projectId !== prerequisite.projectId) {
      throw new RuleViolationError("DEPENDENCY_MISMATCH", "Tasks belong to different projects");
    }
    await openProject(tx, task.projectId);

    const edges = await tx.taskDependency.findMany({
      where: { task: { projectId: task.projectId } },
    });
    if (wouldCreateCycle(edges, taskId, dependsOnId)) {
      throw new RuleViolationError("DEPENDENCY_CYCLE", "This link would create a cycle");
    }
    if (edges.some((e) => e.taskId === taskId && e.dependsOnId === dependsOnId)) {
      return { taskId, dependsOnId };
    }
    await tx.taskDependency.create({ data: { taskId, dependsOnId } });
    await audit(tx, ctx, actor, "task.dependency_added", "task", taskId, {
      projectId: task.projectId,
      dependsOnId,
    });
    return { taskId, dependsOnId };
  });
}

export async function removeDependency(ctx: CrmContext, taskId: string, dependsOnId: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound("Task");
    await openProject(tx, task.projectId);
    const removed = await tx.taskDependency.deleteMany({ where: { taskId, dependsOnId } });
    if (removed.count > 0) {
      await audit(tx, ctx, actor, "task.dependency_removed", "task", taskId, {
        projectId: task.projectId,
        dependsOnId,
      });
    }
    return { taskId, dependsOnId };
  });
}

// ---------------------------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------------------------

/** A finished task is reopened before its checklist changes, so "done" never lies. */
async function editableTask(tx: Tx, taskId: string) {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  const project = await openProject(tx, task.projectId);
  assertWorkAllowed(project.status);
  if (task.status === "done") {
    throw new RuleViolationError("TASK_DONE", "Reopen the task before changing its checklist");
  }
  return task;
}

export async function addChecklistItem(ctx: CrmContext, taskId: string, text: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const value = checklistTextInput.parse(text);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const task = await editableTask(tx, taskId);
    const last = await tx.checklistItem.aggregate({ where: { taskId }, _max: { position: true } });
    const item = await tx.checklistItem.create({
      data: { taskId, text: value, position: (last._max.position ?? -1) + 1 },
    });
    await audit(tx, ctx, actor, "checklist.changed", "task", taskId, {
      projectId: task.projectId,
      change: "added",
    });
    return { id: item.id };
  });
}

export async function setChecklistItemDone(
  ctx: CrmContext,
  itemId: string,
  done: boolean,
  now = new Date(),
) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const item = await tx.checklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound("Checklist item");
    const task = await editableTask(tx, item.taskId);
    await tx.checklistItem.update({
      where: { id: itemId },
      data: { done, doneAt: done ? now : null, doneById: done ? actor.id : null },
    });
    await audit(tx, ctx, actor, "checklist.changed", "task", item.taskId, {
      projectId: task.projectId,
      change: done ? "checked" : "unchecked",
    });
    return { id: itemId, done };
  });
}

export async function deleteChecklistItem(ctx: CrmContext, itemId: string) {
  assertCan(ctx.actor, "project:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const item = await tx.checklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound("Checklist item");
    const task = await editableTask(tx, item.taskId);
    await tx.checklistItem.delete({ where: { id: itemId } });
    await audit(tx, ctx, actor, "checklist.changed", "task", item.taskId, {
      projectId: task.projectId,
      change: "removed",
    });
    return { id: itemId };
  });
}
