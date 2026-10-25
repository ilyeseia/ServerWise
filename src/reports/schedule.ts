/**
 * Scheduled Report Generation Service
 *
 * Manages scheduled report execution based on cron expressions.
 * Runs as a background worker or can be triggered manually.
 */

import { prisma } from "@/generated/prisma/client";
import { getTranslations } from "next-intl/server";
import { generateReportContent } from "./api/route";

interface ReportScheduleConfig {
  id: string;
  userId: string;
  templateId: string;
  cronExpression: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: string;
  recipientEmails: string[] | null;
}

/**
 * Parse cron expression to determine next run time.
 * Supports standard 5-field cron: minute hour day month weekday
 * Example: "0 9 * * 1" = every Monday at 9:00 AM
 */
export function calculateNextRun(cronExpression: string, from: Date = new Date()): Date | null {
  try {
    // Simple cron parser for common patterns
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      console.warn(`Invalid cron expression: ${cronExpression}`);
      return null;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const now = new Date(from);
    let nextRun = new Date(now);

    // Set to the specified minute and hour
    nextRun.setMinutes(parseInt(minute, 10) || 0);
    nextRun.setHours(parseInt(hour, 10) || 0);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);

    // If the time has already passed today, move to next day
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    // Handle day of week restriction (0 = Sunday, 1 = Monday, etc.)
    if (dayOfWeek !== "*") {
      const targetDayOfWeek = parseInt(dayOfWeek, 10);
      while (nextRun.getDay() !== targetDayOfWeek) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
    }

    // Handle day of month restriction
    if (dayOfMonth !== "*") {
      const targetDay = parseInt(dayOfMonth, 10);
      while (nextRun.getDate() !== targetDay) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
    }

    // Handle month restriction
    if (month !== "*") {
      const targetMonth = parseInt(month, 10) - 1; // 0-indexed
      while (nextRun.getMonth() !== targetMonth) {
        nextRun.setMonth(nextRun.getMonth() + 1);
        nextRun.setDate(1); // Reset to first of month
      }
    }

    return nextRun;
  } catch (error) {
    console.error(`Failed to parse cron expression: ${cronExpression}`, error);
    return null;
  }
}

/**
 * Get all active report schedules that are due to run.
 */
export async function getDueSchedules(): Promise<Array<{
  id: string;
  userId: string;
  templateId: string;
  cronExpression: string;
  nextRunAt: Date | null;
  status: string;
  recipientEmails: string[] | null;
}>> {
  const now = new Date();

  return prisma.reportSchedule.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: new Date() },
    },
  });
}

/**
 * Execute a scheduled report.
 */
export async function executeScheduledReport(scheduleId: string): Promise<{
  success: boolean;
  error?: string;
  reportId?: string;
}> {
  const schedule = await prisma.reportSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    return { success: false, error: "Schedule not found" };
  }

  if (schedule.status !== "active") {
    return { success: false, error: "Schedule is not active" };
  }

  try {
    // Generate the report
    const result = await generateReportContent({
      type: "scheduled",
      format: "pdf", // Default to PDF for scheduled
      data: [], // Would fetch from template
      total: 0,
      t: await getTranslations("Reports"),
      user: { name: "Scheduled Report" },
    });

    // Update schedule with next run time
    const nextRunAt = calculateNextRun(schedule.cronExpression);

    await prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        status: "active",
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`Failed to execute scheduled report ${scheduleId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run all due scheduled reports.
 * This should be called by a background worker on a regular interval.
 */
export async function runDueScheduledReports(): Promise<{
  executed: number;
  failed: number;
  errors: string[];
}> {
  const dueSchedules = await getDueSchedules();
  let executed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const schedule of dueSchedules) {
    const result = await executeScheduledReport(schedule.id);
    if (result.success) {
      executed++;
    } else {
      failed++;
      errors.push(`Schedule ${schedule.id}: ${result.error}`);
    }
  }

  return { executed, failed, errors };
}

/**
 * Create a new report schedule.
 */
export async function createReportSchedule({
  userId,
  templateId,
  cronExpression,
  recipientEmails,
}: {
  userId: string;
  templateId: string;
  cronExpression: string;
  recipientEmails?: string[];
}) {
  const nextRunAt = calculateNextRun(cronExpression);

  return prisma.reportSchedule.create({
    data: {
      userId,
      templateId,
      cronExpression,
      nextRunAt,
      recipientEmails: recipientEmails ? JSON.stringify(recipientEmails) : null,
      status: "active",
    },
  });
}

/**
 * Update a report schedule.
 */
export async function updateReportSchedule(
  id: string,
  data: {
    cronExpression?: string;
    recipientEmails?: string[];
    status?: string;
  }
) {
  const updateData: any = { ...data };

  if (data.cronExpression) {
    updateData.nextRunAt = calculateNextRun(data.cronExpression);
  }

  if (data.recipientEmails) {
    updateData.recipientEmails = JSON.stringify(data.recipientEmails);
  }

  return prisma.reportSchedule.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Delete a report schedule.
 */
export async function deleteReportSchedule(id: string) {
  return prisma.reportSchedule.delete({ where: { id } });
}

/**
 * List report schedules for a user.
 */
export async function listUserReportSchedules(userId: string) {
  return prisma.reportSchedule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a single report schedule.
 */
export async function getReportSchedule(id: string) {
  return prisma.reportSchedule.findUnique({
    where: { id },
  });
}