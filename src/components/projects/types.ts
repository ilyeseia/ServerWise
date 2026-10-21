import type { TaskBlocker, TaskStatus } from "@/modules/projects/rules";

export interface StaffVM {
  id: string;
  name: string;
}

export interface MilestoneVM {
  id: string;
  title: string;
  /** yyyy-mm-dd or null */
  dueDate: string | null;
  done: boolean;
}

export interface TaskVM {
  id: string;
  kind: "survey" | "rollback" | "work" | "test" | "handover" | "custom";
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  milestoneId: string | null;
  /** yyyy-mm-dd or null */
  dueDate: string | null;
  dependsOn: string[];
  checklist: { id: string; text: string; done: boolean }[];
  blockers: { start: TaskBlocker[]; finish: TaskBlocker[] };
}
