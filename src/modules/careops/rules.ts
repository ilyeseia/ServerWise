/**
 * Maintenance and support rules as pure functions: ticket state machine, maintenance due dates,
 * contract and warranty states. No I/O and no clock: callers pass `now`, so every rule is
 * deterministic and unit-tested. Dates are calendar dates handled in UTC.
 */

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 *   open ─▶ in_progress ⇄ waiting_customer
 *     ╲          │              │
 *      ╰─────────▼──────────────▼──▶ resolved ─▶ closed (final)
 *                                       │
 *                                       ╰─▶ in_progress (reopen)
 */
const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "waiting_customer", "resolved", "closed"],
  in_progress: ["open", "waiting_customer", "resolved"],
  waiting_customer: ["in_progress", "resolved", "closed"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

export function allowedNextTicketStatuses(from: TicketStatus): readonly TicketStatus[] {
  return TICKET_TRANSITIONS[from];
}

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export const isTicketClosed = (status: TicketStatus) => status === "closed";
/** Resolved and closed tickets no longer need attention. */
export const isTicketOpen = (status: TicketStatus) => status !== "resolved" && status !== "closed";

export type TicketBlocker = "RESOLUTION_REQUIRED";

/** A ticket is only resolved with a written resolution. */
export function ticketBlockers(
  to: TicketStatus,
  facts: { resolution: string | null | undefined },
): TicketBlocker[] {
  return to === "resolved" && !facts.resolution?.trim() ? ["RESOLUTION_REQUIRED"] : [];
}

const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Sort key: most urgent first (used for lists and the dashboard). */
export const priorityRank = (priority: TicketPriority) => PRIORITY_RANK[priority];

// ---------------------------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Calendar date (UTC midnight) of an instant. */
export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Adds calendar months in UTC, clamping to the last day of the target month, so 31 January plus
 * one month is the end of February rather than a date in March.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)));
}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Maintenance schedules
// ---------------------------------------------------------------------------------------------

export interface ScheduleFacts {
  /** First due date. */
  anchorDate: Date;
  /** Months between visits (1..60). */
  intervalMonths: number;
  /** When the last visit was done, if any. */
  lastDoneAt: Date | null;
  /** The contract's end: nothing falls due after it. */
  contractEndsAt: Date | null;
}

/**
 * The next visit date: the anchor until a visit is done, then one interval after the last visit.
 * Returns null when it would fall after the end of the contract.
 */
export function nextDueDate(facts: ScheduleFacts): Date | null {
  const due = facts.lastDoneAt
    ? addMonthsUtc(startOfDayUtc(facts.lastDoneAt), facts.intervalMonths)
    : startOfDayUtc(facts.anchorDate);
  if (facts.contractEndsAt && due > startOfDayUtc(facts.contractEndsAt)) return null;
  return due;
}

export type ScheduleState = "overdue" | "due_soon" | "upcoming" | "finished";

export const DEFAULT_REMINDER_LEAD_DAYS = 7;

/**
 * overdue   due date before today
 * due_soon  due today or within `leadDays`
 * upcoming  later than that
 * finished  nothing left to do (past the contract end)
 */
export function scheduleState(
  due: Date | null,
  now: Date,
  leadDays = DEFAULT_REMINDER_LEAD_DAYS,
): ScheduleState {
  if (!due) return "finished";
  const today = startOfDayUtc(now);
  if (due < today) return "overdue";
  if (due <= addDaysUtc(today, leadDays)) return "due_soon";
  return "upcoming";
}

/** Idempotency key of one reminder: a schedule has at most one reminder per due date. */
export const reminderKey = (scheduleId: string, due: Date) => `${scheduleId}:${isoDay(due)}`;

// ---------------------------------------------------------------------------------------------
// Contracts and warranties
// ---------------------------------------------------------------------------------------------

export type ContractState = "scheduled" | "active" | "expired" | "cancelled";

export function contractState(
  contract: { startsAt: Date; endsAt: Date; cancelledAt: Date | null },
  now: Date,
): ContractState {
  if (contract.cancelledAt) return "cancelled";
  const today = startOfDayUtc(now);
  if (today < startOfDayUtc(contract.startsAt)) return "scheduled";
  if (today > startOfDayUtc(contract.endsAt)) return "expired";
  return "active";
}

export type RenewalState = "ok" | "expiring" | "expired" | "unknown";

export const DEFAULT_RENEWAL_WARNING_DAYS = 30;

/** For warranties, subscriptions and contracts: when does the cover end? */
export function renewalState(
  endsAt: Date | null,
  now: Date,
  warningDays = DEFAULT_RENEWAL_WARNING_DAYS,
): RenewalState {
  if (!endsAt) return "unknown";
  const today = startOfDayUtc(now);
  const end = startOfDayUtc(endsAt);
  if (end < today) return "expired";
  if (end <= addDaysUtc(today, warningDays)) return "expiring";
  return "ok";
}
