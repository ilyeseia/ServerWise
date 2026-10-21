"use server";

import { revalidatePath } from "next/cache";
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
  recordHandover,
  removeDependency,
  setChecklistItemDone,
  updateMilestone,
  updateProject,
  updateTask,
} from "@/modules/projects/service";
import type { TaskStatus } from "@/modules/projects/rules";
import type {
  HandoverInput,
  MilestoneInput,
  ProjectStatusInput,
  ProjectUpdateInput,
  TaskInput,
} from "@/modules/projects/schemas";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

/** Runs a service call and refreshes the pages that show projects. */
const act = <T extends object>(body: Parameters<typeof run<T>>[0]) =>
  run(async (ctx) => {
    const result = await body(ctx);
    refresh();
    return result;
  });

export async function createProjectAction(
  quoteId: string,
  locale: string,
): Promise<ActionResult<{ id: string }>> {
  return act(async (ctx) => {
    const project = await createProjectFromQuote(ctx, quoteId, locale === "fr" ? "fr" : "ar");
    return { id: project.id };
  });
}

export async function updateProjectAction(
  id: string,
  input: ProjectUpdateInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateProject(ctx, id, input);
    return {};
  });
}

export async function changeProjectStatusAction(
  id: string,
  input: ProjectStatusInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await changeProjectStatus(ctx, id, input);
    return {};
  });
}

export async function recordHandoverAction(
  id: string,
  input: HandoverInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await recordHandover(ctx, id, input);
    return {};
  });
}

export async function createMilestoneAction(
  projectId: string,
  input: MilestoneInput,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await createMilestone(ctx, projectId, input);
    return {};
  });
}

export async function updateMilestoneAction(
  id: string,
  input: MilestoneInput & { done?: boolean },
): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateMilestone(ctx, id, input);
    return {};
  });
}

export async function deleteMilestoneAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await deleteMilestone(ctx, id);
    return {};
  });
}

export async function createTaskAction(projectId: string, input: TaskInput): Promise<ActionResult> {
  return act(async (ctx) => {
    await createTask(ctx, projectId, input);
    return {};
  });
}

export async function updateTaskAction(id: string, input: TaskInput): Promise<ActionResult> {
  return act(async (ctx) => {
    await updateTask(ctx, id, input);
    return {};
  });
}

export async function changeTaskStatusAction(id: string, to: TaskStatus): Promise<ActionResult> {
  return act(async (ctx) => {
    await changeTaskStatus(ctx, id, to);
    return {};
  });
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await deleteTask(ctx, id);
    return {};
  });
}

export async function addDependencyAction(
  taskId: string,
  dependsOnId: string,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await addDependency(ctx, taskId, dependsOnId);
    return {};
  });
}

export async function removeDependencyAction(
  taskId: string,
  dependsOnId: string,
): Promise<ActionResult> {
  return act(async (ctx) => {
    await removeDependency(ctx, taskId, dependsOnId);
    return {};
  });
}

export async function addChecklistItemAction(taskId: string, text: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await addChecklistItem(ctx, taskId, text);
    return {};
  });
}

export async function setChecklistItemDoneAction(id: string, done: boolean): Promise<ActionResult> {
  return act(async (ctx) => {
    await setChecklistItemDone(ctx, id, done);
    return {};
  });
}

export async function deleteChecklistItemAction(id: string): Promise<ActionResult> {
  return act(async (ctx) => {
    await deleteChecklistItem(ctx, id);
    return {};
  });
}
