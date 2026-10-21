import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/modules/crm/customers";
import { changeLeadStatus, createLead } from "@/modules/crm/leads";
import {
  addChecklistItem,
  addDependency,
  changeProjectStatus,
  changeTaskStatus,
  createMilestone,
  createProjectFromQuote,
  createTask,
  deleteChecklistItem,
  deleteMilestone,
  deleteTask,
  findProjectForQuote,
  getProject,
  listProjectStaff,
  listProjects,
  recordHandover,
  removeDependency,
  setChecklistItemDone,
  updateMilestone,
  updateProject,
  updateTask,
} from "@/modules/projects/service";
import { createQuote, decideRevision, issueRevision, saveDraft } from "@/modules/quotes/service";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { auditCount, createStaff, deleteCustomers, unique, type TestStaff } from "./crm-helpers";
import { deleteTestUsers } from "./helpers";

let owner: TestStaff;
let sales: TestStaff;
let technician: TestStaff;
let viewer: TestStaff;
const customerIds: string[] = [];
const anonymous = { actor: undefined };

async function newLead() {
  const customer = await createCustomer(sales.ctx, { type: "individual", name: unique("Proj") });
  customerIds.push(customer.id);
  return createLead(sales.ctx, { customerId: customer.id, title: unique("Lead") });
}

/** An accepted quotation with two lines, ready to become a project. */
async function acceptedQuote() {
  const lead = await newLead();
  const quote = await createQuote(sales.ctx, { leadId: lead.id, title: "Server room" });
  await saveDraft(sales.ctx, quote.revisionId, {
    lines: [
      { kind: "hardware", description: "NAS 4 bay", quantity: "1", unitPrice: "100000" },
      { kind: "labor", description: "Installation", quantity: "4", unitPrice: "2500" },
    ],
  });
  await issueRevision(sales.ctx, quote.revisionId);
  await decideRevision(sales.ctx, quote.revisionId, { decision: "accepted" });
  return { lead, ...quote };
}

async function newProject() {
  const quote = await acceptedQuote();
  const created = await createProjectFromQuote(sales.ctx, quote.id, "fr");
  return { ...quote, projectId: created.id, number: created.number };
}

/** Finishes every task of a project the way staff would: start, check items, complete. */
async function finishAllTasks(projectId: string) {
  const view = await getProject(sales.ctx, projectId);
  for (const task of view.tasks) {
    if (task.status === "done" || task.status === "cancelled") continue;
    await changeTaskStatus(sales.ctx, task.id, "in_progress");
    for (const item of task.checklist) await setChecklistItemDone(sales.ctx, item.id, true);
    await changeTaskStatus(sales.ctx, task.id, "done");
  }
}

describe("projects (integration)", () => {
  beforeAll(async () => {
    [owner, sales, technician, viewer] = await Promise.all([
      createStaff("owner"),
      createStaff("sales"),
      createStaff("technician"),
      createStaff("viewer"),
    ]);
  });

  afterAll(async () => {
    await deleteCustomers(customerIds);
    await deleteTestUsers([owner, sales, technician, viewer].map((s) => s.user));
    await getDb().$disconnect();
  });

  // ---------------------------------------------------------------------------------------
  describe("authorization", () => {
    it("rejects anonymous callers everywhere", async () => {
      const id = crypto.randomUUID();
      for (const call of [
        () => listProjects(anonymous),
        () => getProject(anonymous, id),
        () => listProjectStaff(anonymous),
        () => findProjectForQuote(anonymous, id),
        () => createProjectFromQuote(anonymous, id, "ar"),
        () => updateProject(anonymous, id, { title: "x" }),
        () => changeProjectStatus(anonymous, id, { to: "in_progress" }),
        () => recordHandover(anonymous, id, { notes: "x" }),
        () => createMilestone(anonymous, id, { title: "x" }),
        () => createTask(anonymous, id, { title: "x" }),
        () => changeTaskStatus(anonymous, id, "done"),
        () => addDependency(anonymous, id, id),
        () => addChecklistItem(anonymous, id, "x"),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);
      }
    });

    it("viewers see nothing; technicians work but do not manage", async () => {
      const { projectId, id: quoteId } = await newProject();
      await expect(listProjects(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getProject(viewer.ctx, projectId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createTask(viewer.ctx, projectId, { title: "Sneaky" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await expect(getProject(technician.ctx, projectId)).resolves.toMatchObject({ id: projectId });
      await expect(
        createTask(technician.ctx, projectId, { title: "Cable labels" }),
      ).resolves.toBeDefined();
      for (const call of [
        () => createProjectFromQuote(technician.ctx, quoteId, "ar"),
        () => updateProject(technician.ctx, projectId, { title: "Hijack" }),
        () => changeProjectStatus(technician.ctx, projectId, { to: "in_progress" }),
        () => recordHandover(technician.ctx, projectId, { notes: "x" }),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("creating a project from a quotation", () => {
    it("builds the project and its standard tasks from the accepted quotation", async () => {
      const quote = await acceptedQuote();
      const created = await createProjectFromQuote(sales.ctx, quote.id, "fr");
      expect(created.created).toBe(true);
      expect(created.number).toMatch(/^P-\d{4}-\d{4}$/);

      const view = await getProject(sales.ctx, created.id);
      expect(view).toMatchObject({
        status: "planned",
        title: "Server room",
        quote: { id: quote.id },
        managerId: sales.actor.id,
      });
      expect(view.tasks.map((t) => t.kind)).toEqual([
        "survey",
        "rollback",
        "work",
        "work",
        "test",
        "handover",
      ]);
      expect(view.tasks[2]!.title).toContain("NAS 4 bay");
      expect(view.tasks[3]!.title).toContain("Installation");
      // The survey and the rollback plan come before any work; testing needs all the work.
      expect(view.tasks[2]!.dependsOn).toEqual(
        expect.arrayContaining([view.tasks[0]!.id, view.tasks[1]!.id]),
      );
      expect(view.tasks[4]!.dependsOn).toHaveLength(2);
      expect(view.tasks[5]!.dependsOn).toEqual([view.tasks[4]!.id]);
      expect(view.tasks[0]!.checklist.length).toBeGreaterThan(0);
      expect(view.progress).toEqual({ done: 0, total: 6, percent: 0 });
      expect(await auditCount("project.created", created.id)).toBe(1);
      await expect(findProjectForQuote(sales.ctx, quote.id)).resolves.toMatchObject({
        id: created.id,
      });
    });

    it("is idempotent: asking again returns the same project", async () => {
      const quote = await acceptedQuote();
      const first = await createProjectFromQuote(sales.ctx, quote.id, "ar");
      const second = await createProjectFromQuote(owner.ctx, quote.id, "fr");
      expect(second).toMatchObject({ id: first.id, number: first.number, created: false });
      expect(await getDb().project.count({ where: { quoteId: quote.id } })).toBe(1);
      expect((await getProject(sales.ctx, first.id)).tasks).toHaveLength(6);
      expect(await auditCount("project.created", first.id)).toBe(1);
    });

    it("creates exactly one project when requests arrive at the same time", async () => {
      const quote = await acceptedQuote();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          createProjectFromQuote(index % 2 ? owner.ctx : sales.ctx, quote.id, "ar"),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await getDb().project.count({ where: { quoteId: quote.id } })).toBe(1);
      const tasks = await getDb().task.count({ where: { projectId: results[0]!.id } });
      expect(tasks).toBe(6);
    });

    it("needs an accepted quotation", async () => {
      const lead = await newLead();
      const draft = await createQuote(sales.ctx, { leadId: lead.id, title: "Not yet" });
      await expect(createProjectFromQuote(sales.ctx, draft.id, "ar")).rejects.toMatchObject({
        code: "QUOTE_NOT_ACCEPTED",
      });
      await saveDraft(sales.ctx, draft.revisionId, {
        lines: [{ kind: "service", description: "x", quantity: "1", unitPrice: "10" }],
      });
      await issueRevision(sales.ctx, draft.revisionId);
      await expect(createProjectFromQuote(sales.ctx, draft.id, "ar")).rejects.toMatchObject({
        code: "QUOTE_NOT_ACCEPTED",
      });
      await decideRevision(sales.ctx, draft.revisionId, { decision: "rejected" });
      await expect(createProjectFromQuote(sales.ctx, draft.id, "ar")).rejects.toMatchObject({
        code: "QUOTE_NOT_ACCEPTED",
      });
      await expect(
        createProjectFromQuote(sales.ctx, crypto.randomUUID(), "ar"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lists projects with progress", async () => {
      const { projectId } = await newProject();
      const list = await listProjects(sales.ctx, { pageSize: 100 });
      expect(list.items.find((p) => p.id === projectId)).toMatchObject({
        status: "planned",
        tasksDone: 0,
        tasksTotal: 6,
      });
      expect(
        (await listProjects(sales.ctx, { status: "completed" })).items.every(
          (p) => p.status === "completed",
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("project lifecycle", () => {
    it("needs a rollback plan before work starts", async () => {
      const { projectId } = await newProject();
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "in_progress" }),
      ).rejects.toMatchObject({ code: "ROLLBACK_PLAN_REQUIRED" });

      await updateProject(sales.ctx, projectId, {
        title: "Server room",
        rollbackPlan: "Restore the image taken before the work and re-plug the old switch",
      });
      await changeProjectStatus(sales.ctx, projectId, { to: "in_progress" });
      expect((await getProject(sales.ctx, projectId)).status).toBe("in_progress");
      expect(await auditCount("project.status_changed", projectId)).toBe(1);
      expect(await auditCount("project.updated", projectId)).toBe(1);

      // Once started, the plan can be improved but not erased.
      await expect(
        updateProject(sales.ctx, projectId, { title: "Server room", rollbackPlan: "" }),
      ).rejects.toMatchObject({ code: "ROLLBACK_PLAN_REQUIRED" });
    });

    it("follows the state machine", async () => {
      const { projectId } = await newProject();
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "completed" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "on_hold" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "planned" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    });

    it("can be paused and resumed; tasks cannot change while paused", async () => {
      const { projectId } = await newProject();
      await updateProject(sales.ctx, projectId, { title: "T", rollbackPlan: "Plan B" });
      await changeProjectStatus(sales.ctx, projectId, { to: "in_progress" });
      const survey = (await getProject(sales.ctx, projectId)).tasks[0]!;
      await changeProjectStatus(sales.ctx, projectId, { to: "on_hold" });
      await expect(changeTaskStatus(sales.ctx, survey.id, "in_progress")).rejects.toMatchObject({
        code: "PROJECT_ON_HOLD",
      });
      await changeProjectStatus(sales.ctx, projectId, { to: "in_progress" });
      await expect(changeTaskStatus(sales.ctx, survey.id, "in_progress")).resolves.toBeDefined();
    });

    it("cancelling needs a reason and freezes the project", async () => {
      const { projectId } = await newProject();
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "cancelled" }),
      ).rejects.toMatchObject({ code: "CANCEL_REASON_REQUIRED" });
      await changeProjectStatus(sales.ctx, projectId, {
        to: "cancelled",
        reason: "Customer moved",
      });
      const view = await getProject(sales.ctx, projectId);
      expect(view).toMatchObject({ status: "cancelled", cancelReason: "Customer moved" });

      await expect(createTask(sales.ctx, projectId, { title: "Late" })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
      await expect(
        changeTaskStatus(sales.ctx, view.tasks[0]!.id, "in_progress"),
      ).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
      await expect(updateProject(sales.ctx, projectId, { title: "Renamed" })).rejects.toMatchObject(
        { code: "PROJECT_CLOSED" },
      );
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "in_progress" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    });

    it("completes only after every task is finished and a handover is recorded", async () => {
      const { projectId } = await newProject();
      await updateProject(sales.ctx, projectId, { title: "T", rollbackPlan: "Plan B" });
      await changeProjectStatus(sales.ctx, projectId, { to: "in_progress" });

      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "completed" }),
      ).rejects.toMatchObject({ code: "TASKS_OPEN" });

      await finishAllTasks(projectId);
      await expect(
        changeProjectStatus(sales.ctx, projectId, { to: "completed" }),
      ).rejects.toMatchObject({ code: "HANDOVER_REQUIRED" });

      await expect(recordHandover(sales.ctx, projectId, { notes: "  " })).rejects.toThrow();
      await recordHandover(sales.ctx, projectId, {
        notes:
          "Handed over to Mr. Amine. Credentials: in the customer's password manager, item 12.",
      });
      expect(await auditCount("project.handover_recorded", projectId)).toBe(1);

      const done = await changeProjectStatus(sales.ctx, projectId, { to: "completed" });
      expect(done.status).toBe("completed");
      const view = await getProject(sales.ctx, projectId);
      expect(view.completedAt).toBeInstanceOf(Date);
      expect(view.progress).toEqual({ done: 6, total: 6, percent: 100 });

      // A finished project is history: nothing changes any more.
      await expect(createTask(sales.ctx, projectId, { title: "Extra" })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
      await expect(recordHandover(sales.ctx, projectId, { notes: "again" })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
    });

    it("cannot record a handover before work started", async () => {
      const { projectId } = await newProject();
      await expect(recordHandover(sales.ctx, projectId, { notes: "early" })).rejects.toMatchObject({
        code: "HANDOVER_NOT_ALLOWED",
      });
    });

    it("rejects an unknown manager and bad dates", async () => {
      const { projectId } = await newProject();
      await expect(
        updateProject(sales.ctx, projectId, { title: "T", managerId: viewer.actor.id }),
      ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
      await expect(
        updateProject(sales.ctx, projectId, {
          title: "T",
          startDate: "2026-12-10",
          targetDate: "2026-12-01",
        }),
      ).rejects.toThrow();
      await expect(
        updateProject(sales.ctx, projectId, { title: "T", managerId: technician.actor.id }),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("tasks, dependencies and checklists", () => {
    it("work cannot start before its prerequisites are done", async () => {
      const { projectId } = await newProject();
      const view = await getProject(sales.ctx, projectId);
      const [survey, rollback, hardware] = view.tasks;
      expect(hardware!.blockers.start).toEqual(["DEPENDENCY_OPEN"]);
      await expect(changeTaskStatus(sales.ctx, hardware!.id, "in_progress")).rejects.toMatchObject({
        code: "DEPENDENCY_OPEN",
      });

      for (const prerequisite of [survey!, rollback!]) {
        await changeTaskStatus(sales.ctx, prerequisite.id, "in_progress");
        for (const item of prerequisite.checklist)
          await setChecklistItemDone(sales.ctx, item.id, true);
        await changeTaskStatus(sales.ctx, prerequisite.id, "done");
      }
      await expect(changeTaskStatus(sales.ctx, hardware!.id, "in_progress")).resolves.toBeDefined();
      expect(await auditCount("task.status_changed", hardware!.id)).toBe(1);
    });

    it("a task with unchecked items cannot be completed, and a done task is read-only", async () => {
      const { projectId } = await newProject();
      const survey = (await getProject(sales.ctx, projectId)).tasks[0]!;
      await changeTaskStatus(sales.ctx, survey.id, "in_progress");
      await expect(changeTaskStatus(sales.ctx, survey.id, "done")).rejects.toMatchObject({
        code: "CHECKLIST_OPEN",
      });
      for (const item of survey.checklist) await setChecklistItemDone(sales.ctx, item.id, true);
      await changeTaskStatus(sales.ctx, survey.id, "done");

      await expect(addChecklistItem(sales.ctx, survey.id, "One more")).rejects.toMatchObject({
        code: "TASK_DONE",
      });
      await expect(
        setChecklistItemDone(sales.ctx, survey.checklist[0]!.id, false),
      ).rejects.toMatchObject({ code: "TASK_DONE" });

      // Reopening makes it editable again, and it then needs the new item checked too.
      await changeTaskStatus(sales.ctx, survey.id, "in_progress");
      await addChecklistItem(sales.ctx, survey.id, "One more");
      await expect(changeTaskStatus(sales.ctx, survey.id, "done")).rejects.toMatchObject({
        code: "CHECKLIST_OPEN",
      });
    });

    it("follows the task state machine", async () => {
      const { projectId } = await newProject();
      const survey = (await getProject(sales.ctx, projectId)).tasks[0]!;
      await expect(changeTaskStatus(sales.ctx, survey.id, "done")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      await expect(changeTaskStatus(sales.ctx, survey.id, "todo")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      await changeTaskStatus(sales.ctx, survey.id, "in_progress");
      await changeTaskStatus(sales.ctx, survey.id, "blocked");
      await changeTaskStatus(sales.ctx, survey.id, "in_progress");
      await changeTaskStatus(sales.ctx, survey.id, "cancelled");
      await changeTaskStatus(sales.ctx, survey.id, "todo");
    });

    it("a cancelled prerequisite no longer blocks", async () => {
      const { projectId } = await newProject();
      const [survey, rollback, hardware] = (await getProject(sales.ctx, projectId)).tasks;
      await changeTaskStatus(sales.ctx, survey!.id, "cancelled");
      await changeTaskStatus(sales.ctx, rollback!.id, "cancelled");
      await expect(changeTaskStatus(sales.ctx, hardware!.id, "in_progress")).resolves.toBeDefined();
    });

    it("creates, edits and deletes custom tasks and milestones", async () => {
      const { projectId } = await newProject();
      const milestone = await createMilestone(sales.ctx, projectId, {
        title: "Network ready",
        dueDate: "2026-12-15",
      });
      const task = await createTask(technician.ctx, projectId, {
        title: "Label the cables",
        description: "Both racks",
        milestoneId: milestone.id,
        assigneeId: technician.actor.id,
        dueDate: "2026-12-10",
      });
      const view = await getProject(sales.ctx, projectId);
      expect(view.milestones).toHaveLength(1);
      const created = view.tasks.find((t) => t.id === task.id)!;
      expect(created).toMatchObject({
        kind: "custom",
        status: "todo",
        milestoneId: milestone.id,
        assigneeId: technician.actor.id,
      });
      expect(created.position).toBe(6);

      await updateTask(sales.ctx, task.id, { title: "Label all cables" });
      await updateMilestone(sales.ctx, milestone.id, { title: "Network ready", done: true });
      expect((await getProject(sales.ctx, projectId)).milestones[0]!.doneAt).toBeInstanceOf(Date);

      await expect(
        createTask(sales.ctx, projectId, { title: "Bad", assigneeId: viewer.actor.id }),
      ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
      const other = await newProject();
      const foreign = await createMilestone(sales.ctx, other.projectId, { title: "Elsewhere" });
      await expect(
        createTask(sales.ctx, projectId, { title: "Bad", milestoneId: foreign.id }),
      ).rejects.toMatchObject({ code: "MILESTONE_MISMATCH" });

      await deleteMilestone(sales.ctx, milestone.id);
      expect(
        (await getProject(sales.ctx, projectId)).tasks.find((t) => t.id === task.id)!.milestoneId,
      ).toBeNull();

      await deleteTask(sales.ctx, task.id);
      expect((await getProject(sales.ctx, projectId)).tasks.some((t) => t.id === task.id)).toBe(
        false,
      );
      expect(await auditCount("task.created", task.id)).toBe(1);
      expect(await auditCount("task.deleted", task.id)).toBe(1);
    });

    it("only tasks that have not started can be deleted", async () => {
      const { projectId } = await newProject();
      const survey = (await getProject(sales.ctx, projectId)).tasks[0]!;
      await changeTaskStatus(sales.ctx, survey.id, "in_progress");
      await expect(deleteTask(sales.ctx, survey.id)).rejects.toMatchObject({
        code: "TASK_NOT_DELETABLE",
      });
    });

    it("rejects dependency cycles, self links and links across projects", async () => {
      const { projectId } = await newProject();
      const a = await createTask(sales.ctx, projectId, { title: "A" });
      const b = await createTask(sales.ctx, projectId, { title: "B" });
      const c = await createTask(sales.ctx, projectId, { title: "C" });
      await addDependency(sales.ctx, b.id, a.id); // b needs a
      await addDependency(sales.ctx, c.id, b.id); // c needs b
      await addDependency(sales.ctx, c.id, b.id); // idempotent

      await expect(addDependency(sales.ctx, a.id, c.id)).rejects.toMatchObject({
        code: "DEPENDENCY_CYCLE",
      });
      await expect(addDependency(sales.ctx, a.id, b.id)).rejects.toMatchObject({
        code: "DEPENDENCY_CYCLE",
      });
      await expect(addDependency(sales.ctx, a.id, a.id)).rejects.toMatchObject({
        code: "DEPENDENCY_CYCLE",
      });
      const other = await newProject();
      const foreign = await createTask(sales.ctx, other.projectId, { title: "Foreign" });
      await expect(addDependency(sales.ctx, a.id, foreign.id)).rejects.toMatchObject({
        code: "DEPENDENCY_MISMATCH",
      });

      expect(await getDb().taskDependency.count({ where: { taskId: c.id } })).toBe(1);
      await removeDependency(sales.ctx, c.id, b.id);
      expect(await getDb().taskDependency.count({ where: { taskId: c.id } })).toBe(0);
      await addDependency(sales.ctx, a.id, c.id); // fine now: c no longer needs b
      expect(await auditCount("task.dependency_added", c.id)).toBe(1);
      expect(await auditCount("task.dependency_removed", c.id)).toBe(1);
    });

    it("manages checklist items", async () => {
      const { projectId } = await newProject();
      const task = await createTask(sales.ctx, projectId, { title: "Rack" });
      const item = await addChecklistItem(sales.ctx, task.id, "  Mount rails ");
      const other = await addChecklistItem(sales.ctx, task.id, "Mount switch");
      await setChecklistItemDone(sales.ctx, item.id, true);
      let view = (await getProject(sales.ctx, projectId)).tasks.find((t) => t.id === task.id)!;
      expect(view.checklist.map((i) => [i.text, i.done])).toEqual([
        ["Mount rails", true],
        ["Mount switch", false],
      ]);
      expect(view.blockers.finish).toEqual(["CHECKLIST_OPEN"]);
      await deleteChecklistItem(sales.ctx, other.id);
      view = (await getProject(sales.ctx, projectId)).tasks.find((t) => t.id === task.id)!;
      expect(view.blockers.finish).toEqual([]);
      await expect(addChecklistItem(sales.ctx, task.id, "   ")).rejects.toThrow();
      expect(await auditCount("checklist.changed", task.id)).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("database guarantees (bypassing the application)", () => {
    const raw = (sql: string, ...args: unknown[]) => getDb().$executeRawUnsafe(sql, ...args);

    it("a project needs an accepted quotation, whatever the caller", async () => {
      const lead = await newLead();
      const draft = await createQuote(sales.ctx, { leadId: lead.id, title: "Draft only" });
      await expect(
        raw(
          `INSERT INTO "project" ("id","number","quoteId","leadId","title","updatedAt")
           VALUES (gen_random_uuid()::text, 'P-0000-0001', $1, $2, 'Sneaky', now())`,
          draft.id,
          lead.id,
        ),
      ).rejects.toThrow(/accepted quotation/);
    });

    it("one project per quotation, even with raw SQL", async () => {
      const { id: quoteId, lead } = await newProject();
      await expect(
        raw(
          `INSERT INTO "project" ("id","number","quoteId","leadId","title","updatedAt")
           VALUES (gen_random_uuid()::text, 'P-0000-0002', $1, $2, 'Twin', now())`,
          quoteId,
          lead.id,
        ),
      ).rejects.toThrow();
    });

    it("status rules, completion rules and finality are enforced by constraints", async () => {
      const { projectId } = await newProject();
      await expect(
        raw(`UPDATE "project" SET "status" = 'in_progress' WHERE id = $1`, projectId),
      ).rejects.toThrow(/rollback_plan_before_work/);
      await expect(
        raw(
          `UPDATE "project" SET "status" = 'completed', "completedAt" = now() WHERE id = $1`,
          projectId,
        ),
      ).rejects.toThrow(/invalid project status change/);
      await expect(
        raw(`UPDATE "project" SET "status" = 'cancelled' WHERE id = $1`, projectId),
      ).rejects.toThrow(/cancel_reason/);
      await expect(
        raw(`UPDATE "project" SET "number" = 'P-9999-9999' WHERE id = $1`, projectId),
      ).rejects.toThrow(/identity/);
      await expect(raw(`DELETE FROM "project" WHERE id = $1`, projectId)).rejects.toThrow(
        /cannot be deleted/,
      );

      await changeProjectStatus(sales.ctx, projectId, { to: "cancelled", reason: "Test" });
      await expect(
        raw(`UPDATE "project" SET "title" = 'Edited' WHERE id = $1`, projectId),
      ).rejects.toThrow(/final/);
    });

    it("tasks of a finished project are frozen, and bad data is refused", async () => {
      const { projectId } = await newProject();
      const task = (await getProject(sales.ctx, projectId)).tasks[0]!;
      await expect(
        raw(`UPDATE "task" SET "status" = 'done' WHERE id = $1`, task.id),
      ).rejects.toThrow(/completed_at_matches/);
      await expect(raw(`UPDATE "task" SET "title" = '   ' WHERE id = $1`, task.id)).rejects.toThrow(
        /title_not_blank/,
      );
      await expect(
        raw(`INSERT INTO "task_dependency" ("taskId","dependsOnId") VALUES ($1,$1)`, task.id),
      ).rejects.toThrow();

      await changeProjectStatus(sales.ctx, projectId, { to: "cancelled", reason: "Test" });
      await expect(
        raw(`UPDATE "task" SET "title" = 'Late edit' WHERE id = $1`, task.id),
      ).rejects.toThrow(/project is closed/);
      await expect(raw(`DELETE FROM "task" WHERE id = $1`, task.id)).rejects.toThrow(
        /project is closed/,
      );
      await expect(
        raw(`UPDATE "checklist_item" SET "text" = 'Late' WHERE "taskId" = $1`, task.id),
      ).rejects.toThrow(/project is closed/);
    });

    it("dependency cycles and cross-project links are refused by the database", async () => {
      const { projectId } = await newProject();
      const a = await createTask(sales.ctx, projectId, { title: "A" });
      const b = await createTask(sales.ctx, projectId, { title: "B" });
      await raw(
        `INSERT INTO "task_dependency" ("taskId","dependsOnId") VALUES ($1,$2)`,
        b.id,
        a.id,
      );
      await expect(
        raw(`INSERT INTO "task_dependency" ("taskId","dependsOnId") VALUES ($1,$2)`, a.id, b.id),
      ).rejects.toThrow(/cycle/);

      const other = await newProject();
      const foreign = await createTask(sales.ctx, other.projectId, { title: "F" });
      await expect(
        raw(
          `INSERT INTO "task_dependency" ("taskId","dependsOnId") VALUES ($1,$2)`,
          a.id,
          foreign.id,
        ),
      ).rejects.toThrow(/same project/);
      await expect(
        raw(`UPDATE "task" SET "projectId" = $2 WHERE id = $1`, a.id, other.projectId),
      ).rejects.toThrow(/another project/);
    });

    it("a lost lead does not matter: the project keeps its history", async () => {
      const { projectId, lead } = await newProject();
      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "later" }).catch(
        () => undefined,
      );
      await expect(getProject(sales.ctx, projectId)).resolves.toMatchObject({ id: projectId });
    });
  });
});
