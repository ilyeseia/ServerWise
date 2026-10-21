import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPolicy, recordBackup, recordRestoreTest } from "@/modules/backups/service";
import {
  createContract,
  createSchedule,
  recordServiceReport,
  cancelContract,
} from "@/modules/careops/maintenance";
import { changeTicketStatus, createTicket } from "@/modules/careops/tickets";
import { createCustomer } from "@/modules/crm/customers";
import { changeLeadStatus, createLead } from "@/modules/crm/leads";
import {
  changeProjectStatus,
  changeTaskStatus,
  createProjectFromQuote,
  createTask,
  getProject,
  recordHandover,
  setChecklistItemDone,
  updateProject,
} from "@/modules/projects/service";
import { createQuote, decideRevision, issueRevision, saveDraft } from "@/modules/quotes/service";
import { buildReport, exportReport, type ExportSection } from "@/modules/reports/service";
import { CSV_BOM } from "@/modules/reports/rules";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { createStaff, deleteCustomers, unique, type TestStaff } from "./crm-helpers";
import { deleteTestUsers } from "./helpers";

let owner: TestStaff;
let sales: TestStaff;
let technician: TestStaff;
let viewer: TestStaff;
const customerIds: string[] = [];
let scope: string[] = [];
let evilCustomerId = "";
let reportNow: Date;
const anonymous = { actor: undefined };

const DAY = 86_400_000;
const label = (section: ExportSection, column: string) => `${section}.${column}`;

async function newCustomer(name = unique("Report")) {
  const customer = await createCustomer(sales.ctx, { type: "business", name });
  customerIds.push(customer.id);
  return customer;
}

/** A quotation with one service line at `price`, issued; optionally accepted/rejected. */
async function quote(customerId: string, price: string, answer?: "accepted" | "rejected") {
  const lead = await createLead(sales.ctx, { customerId, title: unique("Lead") });
  const created = await createQuote(sales.ctx, { leadId: lead.id, title: unique("Q") });
  await saveDraft(sales.ctx, created.revisionId, {
    lines: [{ kind: "service", description: "Work", quantity: "1", unitPrice: price }],
  });
  await issueRevision(sales.ctx, created.revisionId);
  if (answer) await decideRevision(sales.ctx, created.revisionId, { decision: answer });
  return { ...created, leadId: lead.id };
}

async function finishProject(projectId: string, completedAt: Date) {
  await updateProject(sales.ctx, projectId, {
    title: "Done project",
    rollbackPlan: "Restore the image",
  });
  await changeProjectStatus(sales.ctx, projectId, { to: "in_progress" });
  for (const task of (await getProject(sales.ctx, projectId)).tasks) {
    await changeTaskStatus(sales.ctx, task.id, "in_progress");
    for (const item of task.checklist) await setChecklistItemDone(sales.ctx, item.id, true);
    await changeTaskStatus(sales.ctx, task.id, "done");
  }
  await recordHandover(sales.ctx, projectId, {
    notes: "Handed over; credentials kept by the customer.",
  });
  await changeProjectStatus(sales.ctx, projectId, { to: "completed" }, completedAt);
}

describe("reports (integration, on data with known answers)", () => {
  beforeAll(async () => {
    [owner, sales, technician, viewer] = await Promise.all([
      createStaff("owner"),
      createStaff("sales"),
      createStaff("technician"),
      createStaff("viewer"),
    ]);
    const a = await newCustomer();
    const b = await newCustomer();
    const evil = await newCustomer('=HYPERLINK("http://evil.example","click")');
    evilCustomerId = evil.id;
    scope = [a.id, b.id, evil.id];

    // --- sales ---------------------------------------------------------------------------------
    // Quotations: 3001.00 accepted, 1000.00 rejected, 2000.50 only issued, 500.00 accepted.
    const q1 = await quote(a.id, "3001.00", "accepted");
    await quote(a.id, "1000.00", "rejected");
    await quote(b.id, "2000.50");
    const q4 = await quote(b.id, "500.00", "accepted");

    // Leads closed in the window: one won, one lost; one still open (the lead of the open quote).
    const won = await createLead(sales.ctx, { customerId: a.id, title: unique("Won") });
    for (const to of ["contacted", "qualified", "proposal", "won"] as const) {
      await changeLeadStatus(sales.ctx, won.id, to);
    }
    const lost = await createLead(sales.ctx, { customerId: b.id, title: unique("Lost") });
    await changeLeadStatus(sales.ctx, lost.id, "lost", { lostReason: "budget" });

    // --- operations ----------------------------------------------------------------------------
    // Project 1 is completed exactly 5 days after it was created; project 2 stays planned with one
    // overdue task.
    const p1 = await createProjectFromQuote(sales.ctx, q1.id, "fr");
    const p1Created = (await getDb().project.findUniqueOrThrow({ where: { id: p1.id } })).createdAt;
    await finishProject(p1.id, new Date(p1Created.getTime() + 5 * DAY));
    const p2 = await createProjectFromQuote(sales.ctx, q4.id, "fr");
    await createTask(sales.ctx, p2.id, {
      title: "Late one",
      dueDate: new Date(Date.now() - DAY).toISOString(),
    });

    // --- support -------------------------------------------------------------------------------
    const t1 = await createTicket(sales.ctx, {
      customerId: a.id,
      title: "Fast fix",
      priority: "normal",
    });
    const t2 = await createTicket(sales.ctx, {
      customerId: a.id,
      title: "Slow fix",
      priority: "normal",
    });
    for (const [ticket, hours] of [
      [t1, 4],
      [t2, 8],
    ] as const) {
      const created = (await getDb().ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .createdAt;
      await changeTicketStatus(
        sales.ctx,
        ticket.id,
        { to: "resolved", resolution: "Fixed" },
        new Date(created.getTime() + hours * 3_600_000),
      );
    }
    await createTicket(sales.ctx, { customerId: b.id, title: "Server down", priority: "urgent" });
    await createTicket(sales.ctx, { customerId: b.id, title: "Cosmetic", priority: "low" });
    await createTicket(sales.ctx, {
      customerId: evil.id,
      title: "=cmd|' /C calc'!A0",
      priority: "high",
    });

    // --- maintenance ---------------------------------------------------------------------------
    const contractOf = async (customerId: string, fee: string, anchorOffsetDays: number) => {
      const contract = await createContract(sales.ctx, {
        customerId,
        title: unique("Contract"),
        startsAt: new Date(Date.now() - 30 * DAY),
        endsAt: new Date(Date.now() + 300 * DAY),
        monthlyFeeDzd: fee,
      });
      await createSchedule(sales.ctx, contract.id, {
        title: "Check",
        intervalMonths: 3,
        anchorDate: new Date(Date.now() + anchorOffsetDays * DAY),
      });
      return contract;
    };
    await contractOf(a.id, "8000", -5); // overdue
    await contractOf(b.id, "4500.50", 8); // due soon (in 2 days at report time)
    const cancelled = await contractOf(b.id, "99999", 8);
    await cancelContract(sales.ctx, cancelled.id, "closed");
    await recordServiceReport(technician.ctx, {
      customerId: a.id,
      performedAt: new Date(),
      summary: "Phone support visit",
    });

    // --- backups -------------------------------------------------------------------------------
    const policy = (name: string, customerId: string) =>
      createPolicy(technician.ctx, {
        customerId,
        name,
        kind: "files",
        frequencyDays: 1,
        destination: "Disk in the safe",
      });
    const healthy = await policy("Healthy", a.id);
    await recordBackup(technician.ctx, healthy.id, { ranAt: new Date(), outcome: "success" });
    await recordRestoreTest(technician.ctx, healthy.id, {
      testedAt: new Date(),
      outcome: "success",
    });
    const failing = await policy("Failing", a.id);
    await recordBackup(technician.ctx, failing.id, { ranAt: new Date(), outcome: "failed" });
    const untested = await policy("Untested", b.id);
    await recordBackup(technician.ctx, untested.id, { ranAt: new Date(), outcome: "success" });
    await policy("Off", b.id).then((p) =>
      getDb().backupPolicy.update({ where: { id: p.id }, data: { active: false } }),
    );

    reportNow = new Date(Date.now() + 6 * DAY); // after every event above, project 1 included
  });

  afterAll(async () => {
    await deleteCustomers(customerIds);
    await deleteTestUsers([owner, sales, technician, viewer].map((s) => s.user));
    await getDb().$disconnect();
  });

  // ---------------------------------------------------------------------------------------
  describe("authorization", () => {
    it("rejects anonymous callers, and gives every role its own view", async () => {
      await expect(buildReport(anonymous, { range: "30d" })).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      for (const staff of [owner, sales, technician, viewer]) {
        await expect(
          buildReport(staff.ctx, { range: "30d", now: reportNow, customerIds: scope }),
        ).resolves.toBeDefined();
      }
    });

    it("money is shown to owner, sales and the read-only viewer - not to technicians", async () => {
      for (const staff of [owner, sales, viewer]) {
        const report = await buildReport(staff.ctx, {
          range: "30d",
          now: reportNow,
          customerIds: scope,
        });
        expect(report.financial, staff.actor.role).toBe(true);
        expect(report.sales.issuedTotalDzd).not.toBeNull();
        expect(report.maintenance.monthlyFeesDzd).not.toBeNull();
      }
      const technicianView = await buildReport(technician.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(technicianView.financial).toBe(false);
      expect(technicianView.sales.issuedTotalDzd).toBeNull();
      expect(technicianView.sales.acceptedTotalDzd).toBeNull();
      expect(technicianView.sales.averageAcceptedDzd).toBeNull();
      expect(technicianView.maintenance.monthlyFeesDzd).toBeNull();
      // Counts are still shown.
      expect(technicianView.sales.quotesIssued).toBe(4);
    });

    it("only owner and sales may export", async () => {
      for (const staff of [technician, viewer]) {
        await expect(
          exportReport(
            staff.ctx,
            "tickets",
            { range: "30d", now: reportNow, customerIds: scope },
            label,
          ),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(
        exportReport(anonymous, "tickets", { range: "30d" }, label),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("figures (computed from known data)", () => {
    it("sales", async () => {
      const { sales: s } = await buildReport(owner.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(s.quotesIssued).toBe(4);
      expect(s.quotesAccepted).toBe(2);
      expect(s.quotesRejected).toBe(1);
      expect(s.acceptanceRatePct).toBe("66.7"); // 2 of 3 answered
      expect(s.issuedTotalDzd).toBe("6501.50"); // 3001.00 + 1000.00 + 2000.50 + 500.00
      expect(s.acceptedTotalDzd).toBe("3501.00");
      expect(s.averageAcceptedDzd).toBe("1750.50");
      expect(s.wonInRange).toBe(1);
      expect(s.lostInRange).toBe(1);
      expect(s.winRatePct).toBe("50.0");
      // Where the leads are now: one won, one lost; the rest are still open.
      expect(s.leadsByStatus.won).toBe(1);
      expect(s.leadsByStatus.lost).toBe(1);
      expect(Object.values(s.leadsByStatus).reduce((a, b) => a + b, 0)).toBe(6);
    });

    it("operations", async () => {
      const { operations } = await buildReport(owner.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(operations.projectsByStatus).toMatchObject({ completed: 1, planned: 1 });
      expect(operations.completedInRange).toBe(1);
      expect(operations.averageDurationDays).toBe("5.0");
      expect(operations.overdueTasks).toBe(1);
      expect(operations.openTasks).toBeGreaterThanOrEqual(1);
    });

    it("support", async () => {
      const { support } = await buildReport(owner.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(support.openNow).toEqual({ low: 1, normal: 0, high: 1, urgent: 1 });
      expect(support.openedInRange).toBe(5);
      expect(support.resolvedInRange).toBe(2);
      expect(support.averageResolutionHours).toBe("6.0"); // (4 h + 8 h) / 2
    });

    it("maintenance", async () => {
      const { maintenance } = await buildReport(owner.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(maintenance.activeContracts).toBe(2); // the cancelled one is not counted
      expect(maintenance.monthlyFeesDzd).toBe("12500.50");
      expect(maintenance.visitsInRange).toBe(1);
      // reportNow is six days ahead: the visit that was due 5 days before today is long overdue, and
      // the one due in 8 days falls due in two days - soon.
      expect(maintenance.overdueVisits).toBe(1);
      expect(maintenance.dueSoonVisits).toBe(1);
    });

    it("backups", async () => {
      // Right now: one healthy policy, one with a failed backup, one never restored (+ one off).
      const { backups } = await buildReport(owner.ctx, {
        range: "30d",
        now: new Date(),
        customerIds: scope,
      });
      expect(backups).toEqual({
        activePolicies: 3,
        critical: 1,
        warning: 1,
        ok: 1,
        neverTested: 2,
      });

      // Six days on, with no new backups, the daily policies are late: nothing stays healthy.
      const later = await buildReport(owner.ctx, {
        range: "30d",
        now: reportNow,
        customerIds: scope,
      });
      expect(later.backups).toEqual({
        activePolicies: 3,
        critical: 1,
        warning: 2,
        ok: 0,
        neverTested: 2,
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("ranges", () => {
    it("events older than the range drop out of it, and rates become 'no data'", async () => {
      const later = new Date(Date.now() + 40 * DAY); // everything above happened ~40 days before
      const month = await buildReport(owner.ctx, { range: "30d", now: later, customerIds: scope });
      expect(month.sales.quotesIssued).toBe(0);
      expect(month.sales.issuedTotalDzd).toBe("0.00");
      expect(month.sales.averageAcceptedDzd).toBeNull(); // nothing to average - not zero
      expect(month.sales.winRatePct).toBeNull();
      expect(month.sales.acceptanceRatePct).toBeNull();
      expect(month.operations.averageDurationDays).toBeNull();
      expect(month.support.averageResolutionHours).toBeNull();

      const quarter = await buildReport(owner.ctx, {
        range: "90d",
        now: later,
        customerIds: scope,
      });
      expect(quarter.sales.quotesIssued).toBe(4);
      expect(quarter.sales.winRatePct).toBe("50.0");
      expect(quarter.support.resolvedInRange).toBe(2);
    });

    it("current-state figures do not depend on the range", async () => {
      const a = await buildReport(owner.ctx, { range: "30d", now: reportNow, customerIds: scope });
      const b = await buildReport(owner.ctx, { range: "365d", now: reportNow, customerIds: scope });
      expect(b.support.openNow).toEqual(a.support.openNow);
      expect(b.backups).toEqual(a.backups);
      expect(b.sales.leadsByStatus).toEqual(a.sales.leadsByStatus);
      expect(b.maintenance.activeContracts).toBe(a.maintenance.activeContracts);
    });

    it("an unrelated customer filter yields an empty report", async () => {
      const empty = await buildReport(owner.ctx, {
        range: "365d",
        now: reportNow,
        customerIds: [crypto.randomUUID()],
      });
      expect(empty.sales.quotesIssued).toBe(0);
      expect(empty.backups.activePolicies).toBe(0);
      expect(empty.maintenance.overdueVisits).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("CSV export", () => {
    it("builds a labelled, dated CSV, audits the export and defuses formulas", async () => {
      const result = await exportReport(
        sales.ctx,
        "tickets",
        { range: "30d", now: reportNow, customerIds: scope },
        label,
      );
      expect(result.filename).toBe(
        `serverwise-tickets-30d-${reportNow.toISOString().slice(0, 10)}.csv`,
      );
      expect(result.rowCount).toBe(5);
      expect(result.csv.startsWith(CSV_BOM)).toBe(true);
      const lines = result.csv.slice(1).split("\r\n");
      expect(lines[0]).toBe(
        "tickets.number,tickets.title,tickets.customer,tickets.status,tickets.priority,tickets.assignee,tickets.openedAt,tickets.resolvedAt",
      );
      // The hostile ticket title is text, not a formula.
      expect(result.csv).toContain("'=cmd|' /C calc'!A0");
      expect(result.csv).not.toMatch(/(^|,)=cmd/m);

      const audit = await getDb().auditLog.findFirst({
        where: { action: "report.exported", actorId: sales.user.id, entityId: "tickets" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit?.metadata).toMatchObject({ range: "30d", rows: 5 });
    });

    it("a customer named like a formula cannot run one", async () => {
      const result = await exportReport(
        owner.ctx,
        "projects",
        { range: "365d", now: reportNow, customerIds: scope },
        label,
      );
      expect(result.rowCount).toBe(2);
      const quotes = await exportReport(
        owner.ctx,
        "quotes",
        { range: "365d", now: reportNow, customerIds: [evilCustomerId] },
        label,
      );
      expect(quotes.rowCount).toBe(0);
      const tickets = await exportReport(
        owner.ctx,
        "tickets",
        { range: "365d", now: reportNow, customerIds: [evilCustomerId] },
        label,
      );
      expect(tickets.csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    });

    it("exports every section with its own columns and the right number of rows", async () => {
      const expected: [ExportSection, number, string][] = [
        ["quotes", 4, "quotes.total"],
        ["tickets", 5, "tickets.number"],
        ["projects", 2, "projects.number"],
        ["maintenance", 2, "maintenance.schedule"],
        ["backups", 4, "backups.policy"],
      ];
      for (const [section, rows, header] of expected) {
        const result = await exportReport(
          owner.ctx,
          section,
          { range: "30d", now: reportNow, customerIds: scope },
          label,
        );
        expect(result.rowCount, section).toBe(rows);
        expect(result.csv, section).toContain(header);
        expect(result.csv.slice(1).split("\r\n").filter(Boolean)).toHaveLength(rows + 1);
      }
    });

    it("quotation totals in the file are exact", async () => {
      const result = await exportReport(
        owner.ctx,
        "quotes",
        { range: "30d", now: reportNow, customerIds: scope },
        label,
      );
      for (const total of ["3001.00", "1000.00", "2000.50", "500.00"]) {
        expect(result.csv).toContain(`,${total}\r\n`);
      }
    });
  });
});
