import { z } from "zod";
import { PROJECT_STATUSES, TASK_STATUSES } from "./rules";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());

const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).max(64).optional());

export const projectUpdateInput = z
  .object({
    title: z.string().trim().min(1, "required").max(200),
    managerId: optionalId,
    startDate: optionalDate,
    targetDate: optionalDate,
    rollbackPlan: optionalText(4000),
  })
  .refine((v) => !v.startDate || !v.targetDate || v.targetDate >= v.startDate, {
    path: ["targetDate"],
    message: "date_order",
  });
export type ProjectUpdateInput = z.input<typeof projectUpdateInput>;

export const projectStatusInput = z.object({
  to: z.enum(PROJECT_STATUSES),
  reason: optionalText(300),
});
export type ProjectStatusInput = z.input<typeof projectStatusInput>;

export const handoverInput = z.object({
  notes: z.string().trim().min(1, "required").max(4000),
});
export type HandoverInput = z.input<typeof handoverInput>;

export const milestoneInput = z.object({
  title: z.string().trim().min(1, "required").max(200),
  dueDate: optionalDate,
});
export type MilestoneInput = z.input<typeof milestoneInput>;

export const taskInput = z.object({
  title: z.string().trim().min(1, "required").max(300),
  description: optionalText(2000),
  milestoneId: optionalId,
  assigneeId: optionalId,
  dueDate: optionalDate,
});
export type TaskInput = z.input<typeof taskInput>;

export const taskStatusInput = z.enum(TASK_STATUSES);

export const checklistTextInput = z.string().trim().min(1, "required").max(300);
