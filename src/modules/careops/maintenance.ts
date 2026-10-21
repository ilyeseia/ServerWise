import { Prisma } from "@/generated/prisma/client";
import { notFound, orNull, type CrmContext, type Page } from "@/modules/crm/context";
import { pageInput } from "@/modules/crm/schemas";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import {
  DEFAULT_REMINDER_LEAD_DAYS,
  contractState,
  isoDay,
  nextDueDate,
  scheduleState,
  startOfDayUtc,
  type ContractState,
  type ScheduleState,
} from "./rules";
import {
  contractInput,
  scheduleInput,
  serviceReportInput,
  type ContractInput,
  type ScheduleInput,
  type ServiceReportInput,
} from "./schemas";

type Tx = Prisma.TransactionClient;

/** A visit cannot be recorded for the future (small tolerance for clock differences). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

async function assertScheduleStaff(tx: Tx, userId: string | undefined) {
  if (!userId) return;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, banned: true },
  });
  if (!user || user.banned || !can(user.role, "maintenance:perform")) {
    throw new RuleViolationError("INVALID_ASSIGNEE", "The selected person cannot be assigned");
  }
}

/** Staff who can carry out maintenance visits. */
export async function listMaintenanceStaff(ctx: CrmContext) {
  assertCan(ctx.actor, "maintenance:read");
  const users = await getDb().user.findMany({
    where: { banned: { not: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users
    .filter((u) => can(u.role, "maintenance:perform"))
    .map(({ id, name }) => ({ id, name }));
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface ContractListItem {
  id: string;
  title: string;
  customerId: string;
  customerName: string;
  startsAt: Date;
  endsAt: Date;
  state: ContractState;
  monthlyFeeDzd: string | null;
  assets: number;
}

export async function listContracts(
  ctx: CrmContext,
  query: { customerId?: string; page?: number; pageSize?: number } = {},
  now = new Date(),
): Promise<Page<ContractListItem>> {
  assertCan(ctx.actor, "maintenance:read");
  const { page, pageSize } = pageInput.parse({ page: query.page, pageSize: query.pageSize });
  const where: Prisma.MaintenanceContractWhereInput = query.customerId
    ? { customerId: query.customerId }
    : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.maintenanceContract.count({ where }),
    db.maintenanceContract.findMany({
      where,
      orderBy: { endsAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } }, _count: { select: { assets: true } } },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((c) => ({
      id: c.id,
      title: c.title,
      customerId: c.customerId,
      customerName: c.customer.name,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      state: contractState(c, now),
      monthlyFeeDzd: c.monthlyFeeDzd?.toFixed(2) ?? null,
      assets: c._count.assets,
    })),
  };
}

export interface ScheduleView {
  id: string;
  title: string;
  intervalMonths: number;
  anchorDate: Date;
  lastDoneAt: Date | null;
  active: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  nextDue: Date | null;
  state: ScheduleState;
}

function toScheduleView(
  schedule: Prisma.MaintenanceScheduleGetPayload<{
    include: { assignee: { select: { name: true } } };
  }>,
  contractEndsAt: Date,
  now: Date,
): ScheduleView {
  const nextDue = schedule.active
    ? nextDueDate({
        anchorDate: schedule.anchorDate,
        intervalMonths: schedule.intervalMonths,
        lastDoneAt: schedule.lastDoneAt,
        contractEndsAt,
      })
    : null;
  return {
    id: schedule.id,
    title: schedule.title,
    intervalMonths: schedule.intervalMonths,
    anchorDate: schedule.anchorDate,
    lastDoneAt: schedule.lastDoneAt,
    active: schedule.active,
    assigneeId: schedule.assigneeId,
    assigneeName: schedule.assignee?.name ?? null,
    nextDue,
    state: scheduleState(nextDue, now),
  };
}

export async function getContract(ctx: CrmContext, id: string, now = new Date()) {
  assertCan(ctx.actor, "maintenance:read");
  const contract = await getDb().maintenanceContract.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      assets: {
        include: { asset: { select: { id: true, name: true, kind: true, status: true } } },
      },
      schedules: {
        orderBy: { createdAt: "asc" },
        include: { assignee: { select: { name: true } } },
      },
    },
  });
  if (!contract) throw notFound("Contract");
  const reports = await getDb().serviceReport.findMany({
    where: { schedule: { contractId: id } },
    orderBy: { performedAt: "desc" },
    take: 20,
  });
  return {
    id: contract.id,
    title: contract.title,
    customer: contract.customer,
    startsAt: contract.startsAt,
    endsAt: contract.endsAt,
    monthlyFeeDzd: contract.monthlyFeeDzd?.toFixed(2) ?? null,
    notes: contract.notes,
    cancelledAt: contract.cancelledAt,
    cancelReason: contract.cancelReason,
    state: contractState(contract, now),
    assets: contract.assets.map((a) => a.asset),
    schedules: contract.schedules.map((s) => toScheduleView(s, contract.endsAt, now)),
    reports: reports.map((r) => ({
      id: r.id,
      scheduleId: r.scheduleId,
      performedAt: r.performedAt,
      summary: r.summary,
      partsReplaced: r.partsReplaced,
    })),
  };
}

export interface DueItem {
  scheduleId: string;
  scheduleTitle: string;
  contractId: string;
  contractTitle: string;
  customerId: string;
  customerName: string;
  nextDue: Date;
  state: "overdue" | "due_soon";
  assigneeName: string | null;
}

/** What needs doing now: overdue and soon-due visits of live contracts (the dashboard source). */
export async function listDueMaintenance(
  ctx: CrmContext,
  now = new Date(),
  leadDays = DEFAULT_REMINDER_LEAD_DAYS,
): Promise<DueItem[]> {
  assertCan(ctx.actor, "maintenance:read");
  return collectDue(now, leadDays);
}

/** Not permission-checked: callers (the dashboard, the reports) do their own check. */
export async function collectDue(
  now: Date,
  leadDays: number,
  scheduleIds?: string[],
): Promise<DueItem[]> {
  const schedules = await getDb().maintenanceSchedule.findMany({
    where: {
      active: true,
      ...(scheduleIds ? { id: { in: scheduleIds } } : {}),
      contract: { cancelledAt: null, endsAt: { gte: startOfDayUtc(now) } },
    },
    include: {
      assignee: { select: { name: true } },
      contract: { include: { customer: { select: { id: true, name: true } } } },
    },
  });
  const items: DueItem[] = [];
  for (const s of schedules) {
    if (startOfDayUtc(now) < startOfDayUtc(s.contract.startsAt)) continue;
    const nextDue = nextDueDate({
      anchorDate: s.anchorDate,
      intervalMonths: s.intervalMonths,
      lastDoneAt: s.lastDoneAt,
      contractEndsAt: s.contract.endsAt,
    });
    const state = scheduleState(nextDue, now, leadDays);
    if (nextDue && (state === "overdue" || state === "due_soon")) {
      items.push({
        scheduleId: s.id,
        scheduleTitle: s.title,
        contractId: s.contractId,
        contractTitle: s.contract.title,
        customerId: s.contract.customer.id,
        customerName: s.contract.customer.name,
        nextDue,
        state,
        assigneeName: s.assignee?.name ?? null,
      });
    }
  }
  return items.sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());
}

// ---------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------

async function checkContract(tx: Tx, data: ReturnType<typeof contractInput.parse>) {
  const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw notFound("Customer");
  if (customer.status === "archived") {
    throw new RuleViolationError("CUSTOMER_ARCHIVED", "The customer is archived");
  }
  const assetIds = [...new Set(data.assetIds)];
  if (assetIds.length > 0) {
    const assets = await tx.asset.findMany({ where: { id: { in: assetIds } } });
    if (assets.length !== assetIds.length) throw notFound("Asset");
    if (assets.some((a) => a.customerId !== data.customerId)) {
      throw new RuleViolationError(
        "ASSET_CUSTOMER_MISMATCH",
        "An asset belongs to another customer",
      );
    }
  }
  return assetIds;
}

export async function createContract(ctx: CrmContext, input: ContractInput) {
  assertCan(ctx.actor, "maintenance:write");
  const actor = ctx.actor;
  const data = contractInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const assetIds = await checkContract(tx, data);
    const contract = await tx.maintenanceContract.create({
      data: {
        customerId: data.customerId,
        title: data.title,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        monthlyFeeDzd: data.monthlyFeeDzd ? new Prisma.Decimal(data.monthlyFeeDzd) : null,
        notes: orNull(data.notes),
        createdById: actor.id,
        assets: { create: assetIds.map((assetId) => ({ assetId })) },
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "contract.created",
        "contract",
        contract.id,
        { customerId: data.customerId },
        ctx.client,
      ),
    });
    return { id: contract.id };
  });
}

export async function updateContract(ctx: CrmContext, id: string, input: ContractInput) {
  assertCan(ctx.actor, "maintenance:write");
  const actor = ctx.actor;
  const data = contractInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const contract = await tx.maintenanceContract.findUnique({ where: { id } });
    if (!contract) throw notFound("Contract");
    if (contract.cancelledAt) {
      throw new RuleViolationError("CONTRACT_CANCELLED", "A cancelled contract cannot change");
    }
    if (contract.customerId !== data.customerId) {
      throw new RuleViolationError("CONTRACT_CUSTOMER_FIXED", "A contract cannot change customer");
    }
    const assetIds = await checkContract(tx, data);
    await tx.maintenanceContract.update({
      where: { id },
      data: {
        title: data.title,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        monthlyFeeDzd: data.monthlyFeeDzd ? new Prisma.Decimal(data.monthlyFeeDzd) : null,
        notes: orNull(data.notes),
      },
    });
    await tx.contractAsset.deleteMany({ where: { contractId: id } });
    await tx.contractAsset.createMany({
      data: assetIds.map((assetId) => ({ contractId: id, assetId })),
    });
    await tx.auditLog.create({
      data: auditData(actor, "contract.updated", "contract", id, {}, ctx.client),
    });
    return { id };
  });
}

/** Cancelling is final and switches the contract's schedules off. */
export async function cancelContract(
  ctx: CrmContext,
  id: string,
  reason: string,
  now = new Date(),
) {
  assertCan(ctx.actor, "maintenance:write");
  const actor = ctx.actor;
  const text = reason.trim();
  if (!text) throw new RuleViolationError("CANCEL_REASON_REQUIRED", "Say why it is cancelled");
  const db = getDb();

  return db.$transaction(async (tx) => {
    const contract = await tx.maintenanceContract.findUnique({ where: { id } });
    if (!contract) throw notFound("Contract");
    if (contract.cancelledAt) {
      throw new RuleViolationError("CONTRACT_CANCELLED", "The contract is already cancelled");
    }
    await tx.maintenanceContract.update({
      where: { id },
      data: { cancelledAt: now, cancelReason: text.slice(0, 300) },
    });
    await tx.maintenanceSchedule.updateMany({ where: { contractId: id }, data: { active: false } });
    await tx.auditLog.create({
      data: auditData(actor, "contract.cancelled", "contract", id, {}, ctx.client),
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------------------------

export async function createSchedule(ctx: CrmContext, contractId: string, input: ScheduleInput) {
  assertCan(ctx.actor, "maintenance:write");
  const actor = ctx.actor;
  const data = scheduleInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const contract = await tx.maintenanceContract.findUnique({ where: { id: contractId } });
    if (!contract) throw notFound("Contract");
    if (contract.cancelledAt) {
      throw new RuleViolationError("CONTRACT_CANCELLED", "A cancelled contract cannot change");
    }
    await assertScheduleStaff(tx, data.assigneeId);
    const schedule = await tx.maintenanceSchedule.create({
      data: {
        contractId,
        title: data.title,
        intervalMonths: data.intervalMonths,
        anchorDate: startOfDayUtc(data.anchorDate),
        assigneeId: orNull(data.assigneeId),
        active: data.active,
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "schedule.created",
        "schedule",
        schedule.id,
        { contractId },
        ctx.client,
      ),
    });
    return { id: schedule.id };
  });
}

export async function updateSchedule(ctx: CrmContext, id: string, input: ScheduleInput) {
  assertCan(ctx.actor, "maintenance:write");
  const actor = ctx.actor;
  const data = scheduleInput.parse(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const schedule = await tx.maintenanceSchedule.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!schedule) throw notFound("Schedule");
    if (schedule.contract.cancelledAt) {
      throw new RuleViolationError("CONTRACT_CANCELLED", "A cancelled contract cannot change");
    }
    await assertScheduleStaff(tx, data.assigneeId);
    await tx.maintenanceSchedule.update({
      where: { id },
      data: {
        title: data.title,
        intervalMonths: data.intervalMonths,
        anchorDate: startOfDayUtc(data.anchorDate),
        assigneeId: orNull(data.assigneeId),
        active: data.active,
      },
    });
    await tx.auditLog.create({
      data: auditData(actor, "schedule.updated", "schedule", id, {}, ctx.client),
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Service reports (visits)
// ---------------------------------------------------------------------------------------------

/**
 * Records a visit. When it belongs to a schedule, that schedule's next due date moves one interval
 * after the visit, and the reminders it had raised are closed in the same transaction.
 */
export async function recordServiceReport(
  ctx: CrmContext,
  input: ServiceReportInput,
  now = new Date(),
) {
  assertCan(ctx.actor, "maintenance:perform");
  const actor = ctx.actor;
  const data = serviceReportInput.parse(input);
  if (data.performedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new RuleViolationError("FUTURE_DATE", "A visit cannot be recorded in the future");
  }
  const db = getDb();

  return db.$transaction(async (tx) => {
    const [schedule, ticket, asset] = await Promise.all([
      data.scheduleId
        ? tx.maintenanceSchedule.findUnique({
            where: { id: data.scheduleId },
            include: { contract: true },
          })
        : null,
      data.ticketId ? tx.ticket.findUnique({ where: { id: data.ticketId } }) : null,
      data.assetId ? tx.asset.findUnique({ where: { id: data.assetId } }) : null,
    ]);
    if (data.scheduleId && !schedule) throw notFound("Schedule");
    if (data.ticketId && !ticket) throw notFound("Ticket");
    if (data.assetId && !asset) throw notFound("Asset");

    const customerId =
      schedule?.contract.customerId ?? ticket?.customerId ?? asset?.customerId ?? data.customerId;
    if (!customerId) {
      throw new RuleViolationError("CUSTOMER_REQUIRED", "Link the visit to a customer");
    }
    for (const linked of [schedule?.contract.customerId, ticket?.customerId, asset?.customerId]) {
      if (linked && linked !== customerId) {
        throw new RuleViolationError(
          "CUSTOMER_MISMATCH",
          "The links belong to different customers",
        );
      }
    }
    if (schedule?.contract.cancelledAt) {
      throw new RuleViolationError("CONTRACT_CANCELLED", "The contract is cancelled");
    }

    const report = await tx.serviceReport.create({
      data: {
        customerId,
        scheduleId: orNull(data.scheduleId),
        ticketId: orNull(data.ticketId),
        assetId: orNull(data.assetId),
        performedAt: data.performedAt,
        performedById: actor.id,
        summary: data.summary,
        partsReplaced: orNull(data.partsReplaced),
      },
    });

    if (schedule) {
      const performedDay = startOfDayUtc(data.performedAt);
      // Never move the "last done" date backwards: an older visit entered late changes nothing.
      const lastDoneAt =
        schedule.lastDoneAt && schedule.lastDoneAt > performedDay
          ? schedule.lastDoneAt
          : performedDay;
      await tx.maintenanceSchedule.update({ where: { id: schedule.id }, data: { lastDoneAt } });

      // Close the reminders (follow-ups) this visit answers.
      const open = await tx.maintenanceReminder.findMany({
        where: {
          scheduleId: schedule.id,
          dueDate: { lte: performedDay },
          followUp: { status: "open" },
        },
        select: { followUpId: true },
      });
      const followUpIds = open.flatMap((r) => (r.followUpId ? [r.followUpId] : []));
      if (followUpIds.length > 0) {
        await tx.followUp.updateMany({
          where: { id: { in: followUpIds }, status: "open" },
          data: { status: "done", completedAt: now, completedById: actor.id },
        });
      }
    }

    await tx.auditLog.create({
      data: auditData(
        actor,
        "servicereport.recorded",
        "service_report",
        report.id,
        { customerId, scheduleId: data.scheduleId ?? null, ticketId: data.ticketId ?? null },
        ctx.client,
      ),
    });
    return { id: report.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------------------------

export interface ReminderRun {
  created: number;
  alreadyRaised: number;
}

/**
 * Raises a follow-up for every visit that is overdue or due soon, at most once per schedule and
 * due date: the unique key makes the run idempotent, so running it twice (or from two processes
 * at the same time) never produces duplicates. Called by the worker; no user is involved.
 */
export async function generateDueReminders(
  now = new Date(),
  leadDays = DEFAULT_REMINDER_LEAD_DAYS,
  /** Limit the run to some schedules (used by tests and per-contract actions). */
  scheduleIds?: string[],
): Promise<ReminderRun> {
  const due = await collectDue(now, leadDays, scheduleIds);
  const db = getDb();
  const result: ReminderRun = { created: 0, alreadyRaised: 0 };

  for (const item of due) {
    const created = await db.$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "maintenance_reminder" ("id", "scheduleId", "dueDate")
        VALUES (${crypto.randomUUID()}, ${item.scheduleId}, ${item.nextDue})
        ON CONFLICT ("scheduleId", "dueDate") DO NOTHING
        RETURNING "id"`;
      const reminder = inserted[0];
      if (!reminder) return false;

      const schedule = await tx.maintenanceSchedule.findUniqueOrThrow({
        where: { id: item.scheduleId },
        include: { contract: { select: { customerId: true, title: true } } },
      });
      const followUp = await tx.followUp.create({
        data: {
          customerId: schedule.contract.customerId,
          title: `${schedule.title} — ${isoDay(item.nextDue)}`.slice(0, 200),
          dueAt: item.nextDue,
          assignedToId: schedule.assigneeId,
          notes: schedule.contract.title.slice(0, 1000),
        },
      });
      await tx.maintenanceReminder.update({
        where: { id: reminder.id },
        data: { followUpId: followUp.id },
      });
      await tx.auditLog.create({
        data: {
          action: "reminder.generated",
          actorId: null,
          actorEmail: "system",
          entityType: "schedule",
          entityId: item.scheduleId,
          metadata: { dueDate: isoDay(item.nextDue), followUpId: followUp.id },
        },
      });
      return true;
    });
    if (created) result.created += 1;
    else result.alreadyRaised += 1;
  }
  return result;
}

/** Manual "generate now" for people who manage maintenance; same idempotent run. */
export async function generateRemindersNow(ctx: CrmContext, now = new Date()) {
  assertCan(ctx.actor, "maintenance:write");
  return generateDueReminders(now);
}
