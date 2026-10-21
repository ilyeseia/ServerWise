import type { Prisma } from "@/generated/prisma/client";
import { loadPolicyHealth } from "@/modules/backups/service";
import { collectDue } from "@/modules/careops/maintenance";
import type { CrmContext } from "@/modules/crm/context";
import { LEAD_STATUSES, type LeadStatus } from "@/modules/crm/lead-status";
import { auditData } from "@/server/audit/tx";
import { assertCan } from "@/server/authz/guard";
import { can } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import {
  averageMoney,
  csvFilename,
  daysBetween,
  hoursBetween,
  mean,
  rangeFor,
  share,
  sumMoney,
  toCsv,
  type CsvValue,
  type DateRange,
  type RangeKey,
} from "./rules";

/**
 * Reports are computed live from the records - nothing is stored, estimated or hard-coded. Every
 * figure is an aggregate; an empty set gives `null` ("no data"), never an invented zero rate.
 * Money is added exactly and shown only to people holding `report:financial` (others get `null`).
 *
 * `customerIds` narrows every figure to those customers. The screens do not use it yet; it keeps the
 * numbers testable on a shared database and makes a per-customer report a one-line addition.
 */

export interface ReportOptions {
  range: RangeKey;
  now?: Date;
  customerIds?: string[];
}

const OPEN_TICKET = ["open", "in_progress", "waiting_customer"] as const;
const OPEN_TASK = ["todo", "in_progress", "blocked"] as const;
const OPEN_PROJECT = ["planned", "in_progress", "on_hold"] as const;

export interface Report {
  range: RangeKey;
  from: Date;
  to: Date;
  /** Whether the money figures are included (report:financial). */
  financial: boolean;
  sales: {
    /** Where the leads are now, whatever their age. */
    leadsByStatus: Record<LeadStatus, number>;
    wonInRange: number;
    lostInRange: number;
    /** Won / (won + lost) among leads closed in the range; null if none closed. */
    winRatePct: string | null;
    quotesIssued: number;
    quotesAccepted: number;
    quotesRejected: number;
    /** Accepted / (accepted + rejected) among quotations answered in the range. */
    acceptanceRatePct: string | null;
    issuedTotalDzd: string | null;
    acceptedTotalDzd: string | null;
    averageAcceptedDzd: string | null;
  };
  operations: {
    projectsByStatus: Record<(typeof OPEN_PROJECT)[number] | "completed" | "cancelled", number>;
    completedInRange: number;
    /** Days from creation to completion, for projects completed in the range. */
    averageDurationDays: string | null;
    openTasks: number;
    overdueTasks: number;
  };
  support: {
    openNow: Record<"low" | "normal" | "high" | "urgent", number>;
    openedInRange: number;
    resolvedInRange: number;
    /** Hours from opening to resolution, for tickets resolved in the range. */
    averageResolutionHours: string | null;
  };
  maintenance: {
    activeContracts: number;
    monthlyFeesDzd: string | null;
    overdueVisits: number;
    dueSoonVisits: number;
    visitsInRange: number;
  };
  backups: {
    activePolicies: number;
    critical: number;
    warning: number;
    ok: number;
    neverTested: number;
  };
}

const where = {
  byLead: (ids?: string[]): Prisma.LeadWhereInput => (ids ? { customerId: { in: ids } } : {}),
  byCustomer: (ids?: string[]) => (ids ? { customerId: { in: ids } } : {}),
};

function financialSet(ctx: CrmContext) {
  return can(ctx.actor?.role, "report:financial");
}

export async function buildReport(ctx: CrmContext, options: ReportOptions): Promise<Report> {
  assertCan(ctx.actor, "report:read");
  const now = options.now ?? new Date();
  const range = rangeFor(options.range, now);
  const ids = options.customerIds;
  const financial = financialSet(ctx);
  const db = getDb();
  const inWindow = { gte: range.from, lt: range.to };
  const quoteScope: Prisma.QuoteRevisionWhereInput = ids
    ? { quote: { lead: { customerId: { in: ids } } } }
    : {};
  const projectScope: Prisma.ProjectWhereInput = ids ? { lead: { customerId: { in: ids } } } : {};

  const [
    leadGroups,
    won,
    lost,
    issued,
    accepted,
    rejected,
    projectGroups,
    completed,
    openTasks,
    overdueTasks,
    openTickets,
    openedInRange,
    resolved,
    contracts,
    due,
    visitsInRange,
    policies,
  ] = await Promise.all([
    db.lead.groupBy({ by: ["status"], where: where.byLead(ids), _count: { _all: true } }),
    db.lead.count({ where: { ...where.byLead(ids), status: "won", closedAt: inWindow } }),
    db.lead.count({ where: { ...where.byLead(ids), status: "lost", closedAt: inWindow } }),
    db.quoteRevision.findMany({
      where: { ...quoteScope, issuedAt: inWindow },
      select: { totalDzd: true },
    }),
    db.quoteRevision.findMany({
      where: { ...quoteScope, status: "accepted", decidedAt: inWindow },
      select: { totalDzd: true },
    }),
    db.quoteRevision.count({ where: { ...quoteScope, status: "rejected", decidedAt: inWindow } }),
    db.project.groupBy({ by: ["status"], where: projectScope, _count: { _all: true } }),
    db.project.findMany({
      where: { ...projectScope, status: "completed", completedAt: inWindow },
      select: { createdAt: true, completedAt: true },
    }),
    db.task.count({
      where: {
        status: { in: [...OPEN_TASK] },
        project: { ...projectScope, status: { in: [...OPEN_PROJECT] } },
      },
    }),
    db.task.count({
      where: {
        status: { in: [...OPEN_TASK] },
        dueDate: { lt: now },
        project: { ...projectScope, status: { in: [...OPEN_PROJECT] } },
      },
    }),
    db.ticket.groupBy({
      by: ["priority"],
      where: { ...where.byCustomer(ids), status: { in: [...OPEN_TICKET] } },
      _count: { _all: true },
    }),
    db.ticket.count({ where: { ...where.byCustomer(ids), createdAt: inWindow } }),
    db.ticket.findMany({
      where: { ...where.byCustomer(ids), resolvedAt: inWindow },
      select: { createdAt: true, resolvedAt: true },
    }),
    db.maintenanceContract.findMany({
      where: {
        ...where.byCustomer(ids),
        cancelledAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      select: { monthlyFeeDzd: true },
    }),
    collectDue(now, 7),
    db.serviceReport.count({
      where: { ...where.byCustomer(ids), performedAt: inWindow },
    }),
    loadPolicyHealth(ids, now),
  ]);

  const count = <K extends string>(
    groups: { _count: { _all: number } }[],
    keys: K[],
    pick: (g: never) => K,
  ) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        groups.filter((g) => pick(g as never) === key).reduce((sum, g) => sum + g._count._all, 0),
      ]),
    ) as Record<K, number>;

  const dueForScope = ids ? due.filter((item) => ids.includes(item.customerId)) : due;
  const activePolicies = policies.filter((p) => p.active);
  const fees = contracts.flatMap((c) => (c.monthlyFeeDzd ? [c.monthlyFeeDzd.toFixed(2)] : []));

  return {
    range: options.range,
    from: range.from,
    to: range.to,
    financial,
    sales: {
      leadsByStatus: count(
        leadGroups as { status: LeadStatus; _count: { _all: number } }[],
        [...LEAD_STATUSES],
        ((g: { status: LeadStatus }) => g.status) as never,
      ),
      wonInRange: won,
      lostInRange: lost,
      winRatePct: share(won, lost),
      quotesIssued: issued.length,
      quotesAccepted: accepted.length,
      quotesRejected: rejected,
      acceptanceRatePct: share(accepted.length, rejected),
      issuedTotalDzd: financial ? sumMoney(issued.map((r) => r.totalDzd.toFixed(2))) : null,
      acceptedTotalDzd: financial ? sumMoney(accepted.map((r) => r.totalDzd.toFixed(2))) : null,
      averageAcceptedDzd: financial
        ? averageMoney(accepted.map((r) => r.totalDzd.toFixed(2)))
        : null,
    },
    operations: {
      projectsByStatus: count(
        projectGroups as { status: string; _count: { _all: number } }[],
        [...OPEN_PROJECT, "completed", "cancelled"] as never[],
        ((g: { status: string }) => g.status) as never,
      ) as Report["operations"]["projectsByStatus"],
      completedInRange: completed.length,
      averageDurationDays: mean(completed.map((p) => daysBetween(p.createdAt, p.completedAt!))),
      openTasks,
      overdueTasks,
    },
    support: {
      openNow: count(
        openTickets as { priority: string; _count: { _all: number } }[],
        ["low", "normal", "high", "urgent"] as never[],
        ((g: { priority: string }) => g.priority) as never,
      ) as Report["support"]["openNow"],
      openedInRange,
      resolvedInRange: resolved.length,
      averageResolutionHours: mean(resolved.map((t) => hoursBetween(t.createdAt, t.resolvedAt!))),
    },
    maintenance: {
      activeContracts: contracts.length,
      monthlyFeesDzd: financial ? sumMoney(fees) : null,
      overdueVisits: dueForScope.filter((d) => d.state === "overdue").length,
      dueSoonVisits: dueForScope.filter((d) => d.state === "due_soon").length,
      visitsInRange,
    },
    backups: {
      activePolicies: activePolicies.length,
      critical: activePolicies.filter((p) => p.health === "critical").length,
      warning: activePolicies.filter((p) => p.health === "warning").length,
      ok: activePolicies.filter((p) => p.health === "ok").length,
      neverTested: activePolicies.filter((p) => p.restore === "never_tested").length,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------

export const EXPORT_SECTIONS = ["quotes", "tickets", "projects", "maintenance", "backups"] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export function isExportSection(value: string | null | undefined): value is ExportSection {
  return (EXPORT_SECTIONS as readonly string[]).includes(value ?? "");
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

interface Table {
  columns: string[];
  rows: CsvValue[][];
}

async function table(
  ctx: CrmContext,
  section: ExportSection,
  range: DateRange,
  now: Date,
  ids: string[] | undefined,
): Promise<Table> {
  const db = getDb();
  const inWindow = { gte: range.from, lt: range.to };

  switch (section) {
    case "quotes": {
      const financial = financialSet(ctx);
      const rows = await db.quoteRevision.findMany({
        where: {
          issuedAt: inWindow,
          ...(ids ? { quote: { lead: { customerId: { in: ids } } } } : {}),
        },
        orderBy: { issuedAt: "desc" },
        take: 5000,
        include: {
          quote: {
            select: {
              number: true,
              title: true,
              lead: { select: { customer: { select: { name: true } } } },
            },
          },
        },
      });
      return {
        columns: [
          "number",
          "revision",
          "title",
          "customer",
          "status",
          "issuedAt",
          "validUntil",
          ...(financial ? ["total"] : []),
        ],
        rows: rows.map((r) => [
          r.quote.number,
          r.number,
          r.quote.title,
          r.quote.lead.customer.name,
          r.status,
          iso(r.issuedAt),
          iso(r.validUntil),
          ...(financial ? [r.totalDzd.toFixed(2)] : []),
        ]),
      };
    }
    case "tickets": {
      const rows = await db.ticket.findMany({
        where: { createdAt: inWindow, ...where.byCustomer(ids) },
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: { customer: { select: { name: true } }, assignee: { select: { name: true } } },
      });
      return {
        columns: [
          "number",
          "title",
          "customer",
          "status",
          "priority",
          "assignee",
          "openedAt",
          "resolvedAt",
        ],
        rows: rows.map((t) => [
          t.number,
          t.title,
          t.customer.name,
          t.status,
          t.priority,
          t.assignee?.name ?? null,
          iso(t.createdAt),
          iso(t.resolvedAt),
        ]),
      };
    }
    case "projects": {
      const rows = await db.project.findMany({
        where: { createdAt: inWindow, ...(ids ? { lead: { customerId: { in: ids } } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: { lead: { select: { customer: { select: { name: true } } } } },
      });
      return {
        columns: [
          "number",
          "title",
          "customer",
          "status",
          "createdAt",
          "targetDate",
          "completedAt",
        ],
        rows: rows.map((p) => [
          p.number,
          p.title,
          p.lead.customer.name,
          p.status,
          iso(p.createdAt),
          iso(p.targetDate),
          iso(p.completedAt),
        ]),
      };
    }
    case "maintenance": {
      const items = await collectDue(now, 7);
      const scoped = ids ? items.filter((i) => ids.includes(i.customerId)) : items;
      return {
        columns: ["schedule", "contract", "customer", "nextVisit", "state", "assignee"],
        rows: scoped.map((i) => [
          i.scheduleTitle,
          i.contractTitle,
          i.customerName,
          iso(i.nextDue),
          i.state,
          i.assigneeName,
        ]),
      };
    }
    case "backups": {
      const policies = await loadPolicyHealth(ids, now);
      return {
        columns: [
          "policy",
          "customer",
          "kind",
          "active",
          "health",
          "backup",
          "restore",
          "lastSuccess",
          "lastRestoreSuccess",
        ],
        rows: policies.map((p) => [
          p.name,
          p.customerName,
          p.kind,
          p.active ? "yes" : "no",
          p.health,
          p.backup,
          p.restore,
          iso(p.lastSuccessAt),
          iso(p.lastRestoreSuccessAt),
        ]),
      };
    }
  }
}

export interface ExportResult {
  filename: string;
  csv: string;
  rowCount: number;
}

/**
 * Builds a CSV of one section and records the export in the audit log (FR-11). `labelFor` turns a
 * column id into the header in the user's language. Text cells are protected against spreadsheet
 * formulas; the money column is left out for people without `report:financial`.
 */
export async function exportReport(
  ctx: CrmContext,
  section: ExportSection,
  options: ReportOptions,
  labelFor: (section: ExportSection, column: string) => string,
): Promise<ExportResult> {
  assertCan(ctx.actor, "report:read");
  assertCan(ctx.actor, "report:export");
  const actor = ctx.actor;
  const now = options.now ?? new Date();
  const range = rangeFor(options.range, now);
  const { columns, rows } = await table(ctx, section, range, now, options.customerIds);

  await getDb().auditLog.create({
    data: auditData(
      actor,
      "report.exported",
      "report",
      section,
      {
        range: options.range,
        rows: rows.length,
      },
      ctx.client,
    ),
  });
  return {
    filename: csvFilename(section, options.range, now),
    csv: toCsv(
      columns.map((c) => labelFor(section, c)),
      rows,
    ),
    rowCount: rows.length,
  };
}
