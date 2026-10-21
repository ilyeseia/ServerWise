import { describe, expect, it } from "vitest";
import {
  PROJECT_STATUSES,
  TASK_STATUSES,
  allowedNextProjectStatuses,
  allowedNextTaskStatuses,
  buildInitialTasks,
  canTransitionProject,
  canTransitionTask,
  isProjectClosed,
  projectBlockers,
  taskBlockers,
  wouldCreateCycle,
  type ProjectFacts,
} from "@/modules/projects/rules";

describe("project state machine", () => {
  it("allows exactly the documented moves", () => {
    const table = Object.fromEntries(
      PROJECT_STATUSES.map((s) => [s, [...allowedNextProjectStatuses(s)].sort()]),
    );
    expect(table).toEqual({
      planned: ["cancelled", "in_progress"],
      in_progress: ["cancelled", "completed", "on_hold"],
      on_hold: ["cancelled", "in_progress"],
      completed: [],
      cancelled: [],
    });
  });

  it("never moves to itself and treats completed/cancelled as final", () => {
    for (const s of PROJECT_STATUSES) expect(canTransitionProject(s, s)).toBe(false);
    for (const to of PROJECT_STATUSES) {
      expect(canTransitionProject("completed", to)).toBe(false);
      expect(canTransitionProject("cancelled", to)).toBe(false);
    }
    expect(isProjectClosed("completed")).toBe(true);
    expect(isProjectClosed("on_hold")).toBe(false);
  });

  it("cannot skip straight from planned to completed", () => {
    expect(canTransitionProject("planned", "completed")).toBe(false);
  });
});

describe("project blockers", () => {
  const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
    rollbackPlan: "Restore the image taken before the work",
    handoverRecorded: true,
    tasks: [{ status: "done" }, { status: "cancelled" }],
    ...over,
  });

  it("needs a written rollback plan to start", () => {
    expect(projectBlockers("in_progress", facts())).toEqual([]);
    expect(projectBlockers("in_progress", facts({ rollbackPlan: null }))).toEqual([
      "ROLLBACK_PLAN_REQUIRED",
    ]);
    expect(projectBlockers("in_progress", facts({ rollbackPlan: "   " }))).toEqual([
      "ROLLBACK_PLAN_REQUIRED",
    ]);
  });

  it("completes only when every task is finished and the handover is recorded", () => {
    expect(projectBlockers("completed", facts())).toEqual([]);
    expect(
      projectBlockers(
        "completed",
        facts({ tasks: [{ status: "done" }, { status: "in_progress" }] }),
      ),
    ).toEqual(["TASKS_OPEN"]);
    expect(projectBlockers("completed", facts({ handoverRecorded: false }))).toEqual([
      "HANDOVER_REQUIRED",
    ]);
    expect(projectBlockers("completed", facts({ tasks: [] }))).toEqual(["NO_TASKS"]);
    expect(
      projectBlockers("completed", facts({ tasks: [{ status: "todo" }], handoverRecorded: false })),
    ).toEqual(["TASKS_OPEN", "HANDOVER_REQUIRED"]);
  });

  it("does not block pausing or cancelling", () => {
    const bare = facts({
      rollbackPlan: null,
      handoverRecorded: false,
      tasks: [{ status: "todo" }],
    });
    expect(projectBlockers("on_hold", bare)).toEqual([]);
    expect(projectBlockers("cancelled", bare)).toEqual([]);
  });
});

describe("task state machine", () => {
  it("allows exactly the documented moves", () => {
    const table = Object.fromEntries(
      TASK_STATUSES.map((s) => [s, [...allowedNextTaskStatuses(s)].sort()]),
    );
    expect(table).toEqual({
      todo: ["cancelled", "in_progress"],
      in_progress: ["blocked", "cancelled", "done", "todo"],
      blocked: ["cancelled", "in_progress"],
      done: ["in_progress"],
      cancelled: ["todo"],
    });
  });

  it("cannot jump from todo straight to done", () => {
    expect(canTransitionTask("todo", "done")).toBe(false);
    for (const s of TASK_STATUSES) expect(canTransitionTask(s, s)).toBe(false);
  });
});

describe("task blockers", () => {
  it("work cannot start or finish while a prerequisite is open", () => {
    const open = { dependencyStatuses: ["done", "in_progress"] as const, checklist: [] };
    expect(taskBlockers("in_progress", open)).toEqual(["DEPENDENCY_OPEN"]);
    expect(taskBlockers("done", open)).toEqual(["DEPENDENCY_OPEN"]);
    expect(taskBlockers("blocked", open)).toEqual([]);
    expect(taskBlockers("cancelled", open)).toEqual([]);
  });

  it("cancelled prerequisites no longer hold the work back", () => {
    expect(
      taskBlockers("in_progress", { dependencyStatuses: ["done", "cancelled"], checklist: [] }),
    ).toEqual([]);
  });

  it("is not done while its checklist has unchecked items", () => {
    const facts = {
      dependencyStatuses: [] as const,
      checklist: [{ done: true }, { done: false }],
    };
    expect(taskBlockers("done", facts)).toEqual(["CHECKLIST_OPEN"]);
    expect(taskBlockers("in_progress", facts)).toEqual([]);
    expect(taskBlockers("done", { ...facts, checklist: [{ done: true }] })).toEqual([]);
  });

  it("reports both reasons together", () => {
    expect(
      taskBlockers("done", { dependencyStatuses: ["todo"], checklist: [{ done: false }] }),
    ).toEqual(["DEPENDENCY_OPEN", "CHECKLIST_OPEN"]);
  });
});

describe("dependency cycles", () => {
  const edge = (taskId: string, dependsOnId: string) => ({ taskId, dependsOnId });

  it("rejects a task depending on itself", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("rejects direct and indirect cycles", () => {
    const chain = [edge("b", "a"), edge("c", "b"), edge("d", "c")]; // d -> c -> b -> a
    expect(wouldCreateCycle(chain, "a", "b")).toBe(true); // a -> b would close b -> a
    expect(wouldCreateCycle(chain, "a", "d")).toBe(true);
    expect(wouldCreateCycle(chain, "b", "d")).toBe(true);
  });

  it("accepts valid links, including diamonds", () => {
    const edges = [edge("b", "a"), edge("c", "a"), edge("d", "b")];
    expect(wouldCreateCycle(edges, "d", "c")).toBe(false); // diamond: d -> b,c -> a
    expect(wouldCreateCycle(edges, "c", "b")).toBe(false);
    expect(wouldCreateCycle([], "x", "y")).toBe(false);
  });

  it("terminates on malformed (already cyclic) input", () => {
    const bad = [edge("a", "b"), edge("b", "a")];
    expect(wouldCreateCycle(bad, "c", "a")).toBe(false);
  });
});

describe("initial task template", () => {
  const lines = [
    { kind: "hardware" as const, description: "NAS 4 bay" },
    { kind: "labor" as const, description: "Installation" },
  ];

  it("builds survey, rollback, one task per line, test and handover", () => {
    const tasks = buildInitialTasks(lines, "fr");
    expect(tasks.map((t) => t.kind)).toEqual([
      "survey",
      "rollback",
      "work",
      "work",
      "test",
      "handover",
    ]);
    expect(tasks[2]!.title).toBe("Approvisionner et préparer : NAS 4 bay");
    expect(tasks[3]!.title).toBe("Réaliser : Installation");
  });

  it("wires dependencies so nothing starts before the survey and the rollback plan", () => {
    const tasks = buildInitialTasks(lines, "ar");
    expect(tasks[2]!.dependsOn).toEqual([0, 1]);
    expect(tasks[3]!.dependsOn).toEqual([0, 1]);
    expect(tasks[4]!.dependsOn).toEqual([2, 3]); // tests need all the work
    expect(tasks[5]!.dependsOn).toEqual([4]); // handover needs the tests
    // Every dependency points to an earlier task: the template can never contain a cycle.
    tasks.forEach((task, index) => task.dependsOn.forEach((d) => expect(d).toBeLessThan(index)));
  });

  it("still works for an empty quotation and is deterministic", () => {
    const tasks = buildInitialTasks([], "ar");
    expect(tasks.map((t) => t.kind)).toEqual(["survey", "rollback", "test", "handover"]);
    expect(tasks[2]!.dependsOn).toEqual([0, 1]);
    expect(buildInitialTasks(lines, "fr")).toEqual(buildInitialTasks(lines, "fr"));
  });

  it("gives every locale a title and checklist, and keeps long descriptions bounded", () => {
    for (const locale of ["ar", "fr"] as const) {
      for (const task of buildInitialTasks(lines, locale)) {
        expect(task.title.trim()).not.toBe("");
        expect(task.title.length).toBeLessThanOrEqual(300);
        if (task.kind !== "work") expect(task.checklist.length).toBeGreaterThan(0);
      }
    }
    const long = buildInitialTasks([{ kind: "service", description: "x".repeat(1000) }], "fr");
    expect(long[2]!.title.length).toBeLessThanOrEqual(300);
  });
});
