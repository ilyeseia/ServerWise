import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAsset, getAsset, listAssets, updateAsset } from "@/modules/careops/assets";
import {
  cancelContract,
  createContract,
  createSchedule,
  generateDueReminders,
  generateRemindersNow,
  getContract,
  listContracts,
  listDueMaintenance,
  listMaintenanceStaff,
  recordServiceReport,
  updateContract,
  updateSchedule,
} from "@/modules/careops/maintenance";
import {
  addComment,
  changeTicketStatus,
  createTicket,
  getTicket,
  listTicketStaff,
  listTickets,
  updateTicket,
} from "@/modules/careops/tickets";
import { archiveCustomer, createCustomer } from "@/modules/crm/customers";
import { createLead } from "@/modules/crm/leads";
import { createProjectFromQuote } from "@/modules/projects/service";
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

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);
const day = (date: Date) => date.toISOString().slice(0, 10);

async function newCustomer() {
  const customer = await createCustomer(sales.ctx, { type: "individual", name: unique("Care") });
  customerIds.push(customer.id);
  return customer;
}

async function newAsset(customerId: string, over: Record<string, unknown> = {}) {
  return createAsset(technician.ctx, {
    customerId,
    kind: "server",
    name: unique("Srv"),
    ...over,
  });
}

/** An active contract with one schedule whose first visit is due `anchorOffsetDays` from today. */
async function contractWithSchedule(anchorOffsetDays: number, intervalMonths = 3) {
  const customer = await newCustomer();
  const asset = await newAsset(customer.id);
  const contract = await createContract(sales.ctx, {
    customerId: customer.id,
    title: unique("Contract"),
    startsAt: inDays(-30),
    endsAt: inDays(365),
    monthlyFeeDzd: "8000",
    assetIds: [asset.id],
  });
  const schedule = await createSchedule(sales.ctx, contract.id, {
    title: "Quarterly check",
    intervalMonths,
    anchorDate: inDays(anchorOffsetDays),
    assigneeId: technician.actor.id,
  });
  return { customer, asset, contract, schedule };
}

describe("care operations (integration)", () => {
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
        () => listAssets(anonymous),
        () => getAsset(anonymous, id),
        () => createAsset(anonymous, { customerId: id, kind: "server", name: "x" }),
        () => listTickets(anonymous),
        () => getTicket(anonymous, id),
        () => createTicket(anonymous, { customerId: id, title: "x" }),
        () => changeTicketStatus(anonymous, id, { to: "in_progress" }),
        () => addComment(anonymous, id, "x"),
        () => listContracts(anonymous),
        () =>
          createContract(anonymous, {
            customerId: id,
            title: "x",
            startsAt: new Date(),
            endsAt: new Date(),
          }),
        () =>
          createSchedule(anonymous, id, { title: "x", intervalMonths: 1, anchorDate: new Date() }),
        () => recordServiceReport(anonymous, { performedAt: new Date(), summary: "x" }),
        () => listDueMaintenance(anonymous),
        () => generateRemindersNow(anonymous),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);
      }
    });

    it("viewers see nothing", async () => {
      for (const call of [
        () => listAssets(viewer.ctx),
        () => listTickets(viewer.ctx),
        () => listContracts(viewer.ctx),
        () => listDueMaintenance(viewer.ctx),
        () => listTicketStaff(viewer.ctx),
        () => listMaintenanceStaff(viewer.ctx),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("each role does only its part", async () => {
      const customer = await newCustomer();
      // Sales read assets but do not write them; technicians write assets but not contracts.
      await expect(
        createAsset(sales.ctx, { customerId: customer.id, kind: "nas", name: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listAssets(sales.ctx)).resolves.toBeDefined();

      await expect(
        createContract(technician.ctx, {
          customerId: customer.id,
          title: "x",
          startsAt: inDays(-1),
          endsAt: inDays(30),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listContracts(technician.ctx)).resolves.toBeDefined();

      const { contract, schedule } = await contractWithSchedule(10);
      await expect(
        recordServiceReport(sales.ctx, {
          scheduleId: schedule.id,
          performedAt: new Date(),
          summary: "x",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(cancelContract(technician.ctx, contract.id, "x")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(generateRemindersNow(technician.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("assets", () => {
    it("records, lists and shows an asset with its warranty state", async () => {
      const customer = await newCustomer();
      const asset = await createAsset(technician.ctx, {
        customerId: customer.id,
        kind: "nas",
        name: "Office NAS",
        brand: "Acme",
        model: "N4",
        serialNumber: " SN-001 ",
        os: "Linux",
        version: "7.2",
        location: "Server cabinet",
        installedAt: inDays(-100),
        warrantyUntil: inDays(10),
        credentialsRef: "Customer password manager, item 12",
      });
      expect(await auditCount("asset.created", asset.id)).toBe(1);

      const view = await getAsset(sales.ctx, asset.id);
      expect(view).toMatchObject({
        name: "Office NAS",
        serialNumber: "SN-001",
        credentialsRef: "Customer password manager, item 12",
        warranty: "expiring",
        renewal: "unknown",
        status: "active",
      });
      const list = await listAssets(sales.ctx, { customerId: customer.id });
      expect(list.items.map((a) => a.id)).toEqual([asset.id]);
      expect(list.items[0]).toMatchObject({ brandModel: "Acme N4", warranty: "expiring" });
      expect((await listAssets(sales.ctx, { q: "sn-001", customerId: customer.id })).total).toBe(1);
      expect(
        (await listAssets(sales.ctx, { q: "zzz-nothing", customerId: customer.id })).total,
      ).toBe(0);
    });

    it("updates an asset but never moves it to another customer", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const asset = await newAsset(a.id, { name: "Old name" });
      await updateAsset(technician.ctx, asset.id, {
        customerId: a.id,
        kind: "server",
        name: "New name",
        status: "faulty",
      });
      expect(await getAsset(technician.ctx, asset.id)).toMatchObject({
        name: "New name",
        status: "faulty",
      });
      await expect(
        updateAsset(technician.ctx, asset.id, { customerId: b.id, kind: "server", name: "Hijack" }),
      ).rejects.toMatchObject({ code: "ASSET_CUSTOMER_FIXED" });
      expect(await auditCount("asset.updated", asset.id)).toBe(1);
    });

    it("keeps serial numbers unique per customer only", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      await newAsset(a.id, { serialNumber: "DUP-1" });
      await expect(newAsset(a.id, { serialNumber: "DUP-1" })).rejects.toMatchObject({
        code: "SERIAL_EXISTS",
      });
      await expect(newAsset(b.id, { serialNumber: "DUP-1" })).resolves.toBeDefined();
      await expect(newAsset(a.id, { serialNumber: "" })).resolves.toBeDefined();
      await expect(newAsset(a.id, { serialNumber: "" })).resolves.toBeDefined(); // blank is not a serial
    });

    it("validates references and dates", async () => {
      const customer = await newCustomer();
      await expect(
        createAsset(technician.ctx, {
          customerId: customer.id,
          kind: "server",
          name: "x",
          installedAt: inDays(5),
          warrantyUntil: inDays(1),
        }),
      ).rejects.toThrow();
      await expect(
        createAsset(technician.ctx, { customerId: customer.id, kind: "server", name: "   " }),
      ).rejects.toThrow();
      await expect(
        createAsset(technician.ctx, { customerId: customer.id, kind: "bogus" as never, name: "x" }),
      ).rejects.toThrow();
      await expect(
        createAsset(technician.ctx, {
          customerId: crypto.randomUUID(),
          kind: "server",
          name: "x",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("an archived customer cannot receive new assets", async () => {
      const customer = await newCustomer();
      await archiveCustomer(owner.ctx, customer.id);
      await expect(
        createAsset(technician.ctx, { customerId: customer.id, kind: "server", name: "x" }),
      ).rejects.toMatchObject({ code: "CUSTOMER_ARCHIVED" });
    });

    it("links an asset only to a project of the same customer", async () => {
      const lead = await createLead(sales.ctx, {
        customerId: (await newCustomer()).id,
        title: unique("Lead"),
      });
      const leadRow = await getDb().lead.findUniqueOrThrow({ where: { id: lead.id } });
      const quote = await createQuote(sales.ctx, { leadId: lead.id, title: "Rack" });
      await saveDraft(sales.ctx, quote.revisionId, {
        lines: [{ kind: "service", description: "x", quantity: "1", unitPrice: "10" }],
      });
      await issueRevision(sales.ctx, quote.revisionId);
      await decideRevision(sales.ctx, quote.revisionId, { decision: "accepted" });
      const project = await createProjectFromQuote(sales.ctx, quote.id, "fr");

      await expect(newAsset(leadRow.customerId, { projectId: project.id })).resolves.toBeDefined();
      const stranger = await newCustomer();
      await expect(newAsset(stranger.id, { projectId: project.id })).rejects.toMatchObject({
        code: "PROJECT_CUSTOMER_MISMATCH",
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("tickets", () => {
    it("opens a numbered ticket, edits it and orders by priority", async () => {
      const customer = await newCustomer();
      const asset = await newAsset(customer.id);
      const low = await createTicket(sales.ctx, {
        customerId: customer.id,
        title: "Fan noise",
        priority: "low",
      });
      const urgent = await createTicket(technician.ctx, {
        customerId: customer.id,
        assetId: asset.id,
        title: "Server down",
        description: "No ping since 08:00",
        priority: "urgent",
        assigneeId: technician.actor.id,
      });
      expect(urgent.number).toMatch(/^T-\d{4}-\d{4}$/);
      expect(urgent.number).not.toBe(low.number);
      expect(await auditCount("ticket.created", urgent.id)).toBe(1);

      const list = await listTickets(sales.ctx, { customerId: customer.id });
      expect(list.items.map((t) => t.title)).toEqual(["Server down", "Fan noise"]);
      expect(list.items[0]).toMatchObject({ priority: "urgent", assigneeName: expect.any(String) });
      expect(
        (await listTickets(sales.ctx, { customerId: customer.id, priority: "low" })).total,
      ).toBe(1);
      expect((await listTickets(sales.ctx, { customerId: customer.id, q: "down" })).total).toBe(1);

      await updateTicket(technician.ctx, low.id, { title: "Loud fan", priority: "normal" });
      expect(await getTicket(sales.ctx, low.id)).toMatchObject({
        title: "Loud fan",
        priority: "normal",
      });
    });

    it("never hands the same number to concurrent callers", async () => {
      const customer = await newCustomer();
      const tickets = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createTicket(sales.ctx, { customerId: customer.id, title: `Parallel ${i}` }),
        ),
      );
      expect(new Set(tickets.map((t) => t.number)).size).toBe(5);
    });

    it("rejects an asset of another customer, an invalid assignee, an archived customer", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const foreign = await newAsset(b.id);
      await expect(
        createTicket(sales.ctx, { customerId: a.id, assetId: foreign.id, title: "x" }),
      ).rejects.toMatchObject({ code: "ASSET_CUSTOMER_MISMATCH" });
      await expect(
        createTicket(sales.ctx, { customerId: a.id, title: "x", assigneeId: viewer.actor.id }),
      ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
      await expect(createTicket(sales.ctx, { customerId: a.id, title: "  " })).rejects.toThrow();
      await archiveCustomer(owner.ctx, b.id);
      await expect(createTicket(sales.ctx, { customerId: b.id, title: "x" })).rejects.toMatchObject(
        { code: "CUSTOMER_ARCHIVED" },
      );
    });

    it("follows the state machine, needs a resolution, and closed is final", async () => {
      const customer = await newCustomer();
      const ticket = await createTicket(sales.ctx, { customerId: customer.id, title: "Slow VPN" });

      await expect(
        changeTicketStatus(technician.ctx, ticket.id, { to: "resolved" }),
      ).rejects.toMatchObject({ code: "RESOLUTION_REQUIRED" });
      await changeTicketStatus(technician.ctx, ticket.id, { to: "in_progress" });
      await changeTicketStatus(technician.ctx, ticket.id, { to: "waiting_customer" });
      await changeTicketStatus(technician.ctx, ticket.id, { to: "in_progress" });
      await expect(
        changeTicketStatus(technician.ctx, ticket.id, { to: "resolved", resolution: "   " }),
      ).rejects.toMatchObject({ code: "RESOLUTION_REQUIRED" });
      await changeTicketStatus(technician.ctx, ticket.id, {
        to: "resolved",
        resolution: "MTU was wrong; set to 1380",
      });
      let view = await getTicket(sales.ctx, ticket.id);
      expect(view).toMatchObject({ status: "resolved", resolution: "MTU was wrong; set to 1380" });
      expect(view.resolvedAt).toBeInstanceOf(Date);

      // Reopen, then resolve again without retyping: the text is kept.
      await changeTicketStatus(technician.ctx, ticket.id, { to: "in_progress" });
      expect((await getTicket(sales.ctx, ticket.id)).resolvedAt).toBeNull();
      await changeTicketStatus(technician.ctx, ticket.id, { to: "resolved" });
      await expect(
        changeTicketStatus(technician.ctx, ticket.id, { to: "open" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      await changeTicketStatus(technician.ctx, ticket.id, { to: "closed" });
      view = await getTicket(sales.ctx, ticket.id);
      expect(view.status).toBe("closed");
      expect(view.closedAt).toBeInstanceOf(Date);
      expect(view.nextStatuses).toEqual([]);

      await expect(
        changeTicketStatus(technician.ctx, ticket.id, { to: "in_progress" }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      await expect(
        updateTicket(technician.ctx, ticket.id, { title: "Late", priority: "low" }),
      ).rejects.toMatchObject({ code: "TICKET_CLOSED" });
      await expect(addComment(technician.ctx, ticket.id, "Late")).rejects.toMatchObject({
        code: "TICKET_CLOSED",
      });
      expect(await auditCount("ticket.status_changed", ticket.id)).toBe(7);
    });

    it("an unwanted ticket can be closed straight from open", async () => {
      const customer = await newCustomer();
      const ticket = await createTicket(sales.ctx, { customerId: customer.id, title: "Spam" });
      await changeTicketStatus(sales.ctx, ticket.id, { to: "closed" });
      const view = await getTicket(sales.ctx, ticket.id);
      expect(view.status).toBe("closed");
      expect(view.resolvedAt).toBeNull();
    });

    it("keeps an append-only discussion", async () => {
      const customer = await newCustomer();
      const ticket = await createTicket(sales.ctx, {
        customerId: customer.id,
        title: "Backup fails",
      });
      await addComment(sales.ctx, ticket.id, "  Customer says it started Monday ");
      await addComment(technician.ctx, ticket.id, "Checked the logs");
      await expect(addComment(technician.ctx, ticket.id, "   ")).rejects.toThrow();
      const view = await getTicket(sales.ctx, ticket.id);
      expect(view.comments.map((c) => c.body)).toEqual([
        "Customer says it started Monday",
        "Checked the logs",
      ]);
      expect(view.comments[1]!.authorName).toBe(technician.actor.name);
      expect(await auditCount("ticket.commented", ticket.id)).toBe(2);
      await expect(
        getDb().$executeRawUnsafe(
          `UPDATE "ticket_comment" SET "body" = 'edited' WHERE "ticketId" = $1`,
          ticket.id,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        getDb().$executeRawUnsafe(`DELETE FROM "ticket_comment" WHERE "ticketId" = $1`, ticket.id),
      ).rejects.toThrow(/append-only/);
    });

    it("lists the staff who can take tickets", async () => {
      const staff = await listTicketStaff(sales.ctx);
      expect(staff.map((s) => s.id)).toEqual(
        expect.arrayContaining([owner.actor.id, sales.actor.id, technician.actor.id]),
      );
      expect(staff.map((s) => s.id)).not.toContain(viewer.actor.id);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("contracts and schedules", () => {
    it("creates a contract that covers the customer's assets", async () => {
      const customer = await newCustomer();
      const a = await newAsset(customer.id);
      const b = await newAsset(customer.id);
      const contract = await createContract(sales.ctx, {
        customerId: customer.id,
        title: "Annual care",
        startsAt: inDays(-10),
        endsAt: inDays(355),
        monthlyFeeDzd: "8000.50",
        assetIds: [a.id, b.id, a.id],
      });
      const view = await getContract(sales.ctx, contract.id);
      expect(view).toMatchObject({ state: "active", monthlyFeeDzd: "8000.50" });
      expect(view.assets.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
      expect((await listContracts(sales.ctx, { customerId: customer.id })).items[0]).toMatchObject({
        assets: 2,
        state: "active",
      });
      expect(await auditCount("contract.created", contract.id)).toBe(1);

      await updateContract(sales.ctx, contract.id, {
        customerId: customer.id,
        title: "Annual care (renewed)",
        startsAt: inDays(-10),
        endsAt: inDays(400),
        assetIds: [b.id],
      });
      const updated = await getContract(sales.ctx, contract.id);
      expect(updated.title).toBe("Annual care (renewed)");
      expect(updated.monthlyFeeDzd).toBeNull();
      expect(updated.assets.map((x) => x.id)).toEqual([b.id]);
    });

    it("refuses other customers' assets, bad dates, fees and archived customers", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const foreign = await newAsset(b.id);
      const base = { customerId: a.id, title: "x", startsAt: inDays(-1), endsAt: inDays(30) };
      await expect(
        createContract(sales.ctx, { ...base, assetIds: [foreign.id] }),
      ).rejects.toMatchObject({ code: "ASSET_CUSTOMER_MISMATCH" });
      await expect(
        createContract(sales.ctx, { ...base, startsAt: inDays(10), endsAt: inDays(5) }),
      ).rejects.toThrow();
      await expect(createContract(sales.ctx, { ...base, monthlyFeeDzd: "-5" })).rejects.toThrow();
      await expect(
        createContract(sales.ctx, { ...base, monthlyFeeDzd: "10.999" }),
      ).rejects.toThrow();
      await expect(
        createContract(sales.ctx, { ...base, assetIds: [crypto.randomUUID()] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await archiveCustomer(owner.ctx, b.id);
      await expect(createContract(sales.ctx, { ...base, customerId: b.id })).rejects.toMatchObject({
        code: "CUSTOMER_ARCHIVED",
      });
    });

    it("computes the next visit and the schedule state", async () => {
      const { contract } = await contractWithSchedule(-5); // first visit was due 5 days ago
      const overdue = await getContract(sales.ctx, contract.id);
      expect(overdue.schedules[0]).toMatchObject({ state: "overdue", intervalMonths: 3 });
      expect(day(overdue.schedules[0]!.nextDue!)).toBe(day(inDays(-5)));

      const soon = await getContract(sales.ctx, (await contractWithSchedule(3)).contract.id);
      expect(soon.schedules[0]!.state).toBe("due_soon");
      const later = await getContract(sales.ctx, (await contractWithSchedule(40)).contract.id);
      expect(later.schedules[0]!.state).toBe("upcoming");
    });

    it("validates schedules and keeps assignees to maintenance staff", async () => {
      const { contract, schedule } = await contractWithSchedule(10);
      const ok = { title: "Check", intervalMonths: 6, anchorDate: inDays(20) };
      await expect(
        createSchedule(sales.ctx, contract.id, { ...ok, intervalMonths: 0 }),
      ).rejects.toThrow();
      await expect(
        createSchedule(sales.ctx, contract.id, { ...ok, intervalMonths: 61 }),
      ).rejects.toThrow();
      await expect(createSchedule(sales.ctx, contract.id, { ...ok, title: " " })).rejects.toThrow();
      await expect(
        createSchedule(sales.ctx, contract.id, { ...ok, assigneeId: sales.actor.id }),
      ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
      await updateSchedule(sales.ctx, schedule.id, { ...ok, active: false });
      expect((await getContract(sales.ctx, contract.id)).schedules[0]).toMatchObject({
        active: false,
        nextDue: null,
        state: "finished",
      });
      expect(await auditCount("schedule.updated", schedule.id)).toBe(1);
      expect((await listMaintenanceStaff(sales.ctx)).map((s) => s.id)).toContain(
        technician.actor.id,
      );
    });

    it("cancelling is final and switches schedules off", async () => {
      const { contract, schedule } = await contractWithSchedule(-2);
      await expect(cancelContract(sales.ctx, contract.id, "  ")).rejects.toMatchObject({
        code: "CANCEL_REASON_REQUIRED",
      });
      await cancelContract(sales.ctx, contract.id, "Customer closed the office");
      const view = await getContract(sales.ctx, contract.id);
      expect(view).toMatchObject({
        state: "cancelled",
        cancelReason: "Customer closed the office",
      });
      expect(view.schedules[0]!.active).toBe(false);
      await expect(cancelContract(sales.ctx, contract.id, "again")).rejects.toMatchObject({
        code: "CONTRACT_CANCELLED",
      });
      await expect(
        updateContract(sales.ctx, contract.id, {
          customerId: view.customer.id,
          title: "x",
          startsAt: inDays(-1),
          endsAt: inDays(5),
        }),
      ).rejects.toMatchObject({ code: "CONTRACT_CANCELLED" });
      await expect(
        createSchedule(sales.ctx, contract.id, {
          title: "x",
          intervalMonths: 1,
          anchorDate: inDays(1),
        }),
      ).rejects.toMatchObject({ code: "CONTRACT_CANCELLED" });
      await expect(
        recordServiceReport(technician.ctx, {
          scheduleId: schedule.id,
          performedAt: new Date(),
          summary: "x",
        }),
      ).rejects.toMatchObject({ code: "CONTRACT_CANCELLED" });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("visits (service reports)", () => {
    it("moves the next due date one interval after the visit", async () => {
      const { contract, schedule, customer } = await contractWithSchedule(-4, 3);
      const visit = inDays(-2);
      const report = await recordServiceReport(technician.ctx, {
        scheduleId: schedule.id,
        performedAt: visit,
        summary: "Cleaned filters, checked backups",
        partsReplaced: "1 fan",
      });
      expect(await auditCount("servicereport.recorded", report.id)).toBe(1);

      const view = await getContract(sales.ctx, contract.id);
      expect(day(view.schedules[0]!.lastDoneAt!)).toBe(day(visit));
      // three calendar months after the visit day
      const expected = new Date(
        Date.UTC(visit.getUTCFullYear(), visit.getUTCMonth() + 3, visit.getUTCDate()),
      );
      expect(day(view.schedules[0]!.nextDue!).slice(0, 7)).toBe(day(expected).slice(0, 7));
      expect(view.schedules[0]!.state).toBe("upcoming");
      expect(view.reports[0]).toMatchObject({ summary: "Cleaned filters, checked backups" });
      const stored = await getDb().serviceReport.findUniqueOrThrow({ where: { id: report.id } });
      expect(stored.customerId).toBe(customer.id);
      expect(stored.performedById).toBe(technician.actor.id);
    });

    it("an older visit entered late never moves the schedule backwards", async () => {
      const { schedule, contract } = await contractWithSchedule(-20);
      await recordServiceReport(technician.ctx, {
        scheduleId: schedule.id,
        performedAt: inDays(-1),
        summary: "Recent",
      });
      await recordServiceReport(technician.ctx, {
        scheduleId: schedule.id,
        performedAt: inDays(-15),
        summary: "Forgotten earlier visit",
      });
      const view = await getContract(sales.ctx, contract.id);
      expect(day(view.schedules[0]!.lastDoneAt!)).toBe(day(inDays(-1)));
    });

    it("can be tied to a ticket or an asset instead, and must name a customer somehow", async () => {
      const customer = await newCustomer();
      const asset = await newAsset(customer.id);
      const ticket = await createTicket(sales.ctx, {
        customerId: customer.id,
        title: "Disk alert",
      });
      await expect(
        recordServiceReport(technician.ctx, {
          ticketId: ticket.id,
          performedAt: new Date(),
          summary: "Replaced disk",
        }),
      ).resolves.toBeDefined();
      await expect(
        recordServiceReport(technician.ctx, {
          assetId: asset.id,
          performedAt: new Date(),
          summary: "Updated firmware",
        }),
      ).resolves.toBeDefined();
      await expect(
        recordServiceReport(technician.ctx, {
          customerId: customer.id,
          performedAt: new Date(),
          summary: "Phone support visit",
        }),
      ).resolves.toBeDefined();
      await expect(
        recordServiceReport(technician.ctx, { performedAt: new Date(), summary: "Nowhere" }),
      ).rejects.toMatchObject({ code: "CUSTOMER_REQUIRED" });
      expect((await getTicket(sales.ctx, ticket.id)).serviceReports).toHaveLength(1);
    });

    it("rejects the future, mismatched customers and empty summaries", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const ticket = await createTicket(sales.ctx, { customerId: a.id, title: "x" });
      const foreign = await newAsset(b.id);
      await expect(
        recordServiceReport(technician.ctx, {
          ticketId: ticket.id,
          performedAt: inDays(3),
          summary: "x",
        }),
      ).rejects.toMatchObject({ code: "FUTURE_DATE" });
      await expect(
        recordServiceReport(technician.ctx, {
          ticketId: ticket.id,
          assetId: foreign.id,
          performedAt: new Date(),
          summary: "x",
        }),
      ).rejects.toMatchObject({ code: "CUSTOMER_MISMATCH" });
      await expect(
        recordServiceReport(technician.ctx, {
          ticketId: ticket.id,
          performedAt: new Date(),
          summary: "   ",
        }),
      ).rejects.toThrow();
      await expect(
        recordServiceReport(technician.ctx, {
          scheduleId: crypto.randomUUID(),
          performedAt: new Date(),
          summary: "x",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("reports are append-only, even with raw SQL", async () => {
      const customer = await newCustomer();
      const report = await recordServiceReport(technician.ctx, {
        customerId: customer.id,
        performedAt: new Date(),
        summary: "Original",
      });
      const db = getDb();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "service_report" SET "summary" = 'edited' WHERE id = $1`,
          report.id,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.$executeRawUnsafe(`DELETE FROM "service_report" WHERE id = $1`, report.id),
      ).rejects.toThrow(/append-only/);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("reminders", () => {
    const followUpsOf = (scheduleId: string) =>
      getDb().maintenanceReminder.findMany({ where: { scheduleId }, include: { followUp: true } });

    it("raises one follow-up for a visit that is due, and never a second one", async () => {
      const { schedule, customer } = await contractWithSchedule(3);
      const ids = [schedule.id];
      const first = await generateDueReminders(new Date(), 7, ids);
      expect(first).toEqual({ created: 1, alreadyRaised: 0 });
      const second = await generateDueReminders(new Date(), 7, ids);
      expect(second).toEqual({ created: 0, alreadyRaised: 1 });

      const reminders = await followUpsOf(schedule.id);
      expect(reminders).toHaveLength(1);
      expect(reminders[0]!.followUp).toMatchObject({
        customerId: customer.id,
        status: "open",
        assignedToId: technician.actor.id,
      });
      expect(day(reminders[0]!.followUp!.dueAt)).toBe(day(inDays(3)));
      expect(await auditCount("reminder.generated", schedule.id)).toBe(1);
    });

    it("is safe when several runs happen at the same time", async () => {
      const { schedule } = await contractWithSchedule(-1);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => generateDueReminders(new Date(), 7, [schedule.id])),
      );
      expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(1);
      expect(await followUpsOf(schedule.id)).toHaveLength(1);
      expect(
        await getDb().followUp.count({
          where: {
            title: { contains: "Quarterly check" },
            customer: { id: (await followUpsOf(schedule.id))[0]!.followUp!.customerId },
          },
        }),
      ).toBe(1);
    });

    it("ignores visits that are not due yet, inactive schedules and cancelled contracts", async () => {
      const later = await contractWithSchedule(60);
      const inactive = await contractWithSchedule(1);
      await updateSchedule(sales.ctx, inactive.schedule.id, {
        title: "Quarterly check",
        intervalMonths: 3,
        anchorDate: inDays(1),
        active: false,
      });
      const cancelled = await contractWithSchedule(1);
      await cancelContract(sales.ctx, cancelled.contract.id, "Closed");
      const ids = [later.schedule.id, inactive.schedule.id, cancelled.schedule.id];
      expect(await generateDueReminders(new Date(), 7, ids)).toEqual({
        created: 0,
        alreadyRaised: 0,
      });
      // The same visit becomes due once its lead time is reached.
      expect(await generateDueReminders(new Date(), 90, [later.schedule.id])).toEqual({
        created: 1,
        alreadyRaised: 0,
      });
    });

    it("raises a new reminder for the next visit only after this one was done", async () => {
      const { schedule, contract } = await contractWithSchedule(-1, 1);
      const ids = [schedule.id];
      await generateDueReminders(new Date(), 7, ids);
      const [first] = await followUpsOf(schedule.id);
      expect(first!.followUp!.status).toBe("open");

      // Recording the visit closes the reminder it answers and moves the schedule on.
      await recordServiceReport(technician.ctx, {
        scheduleId: schedule.id,
        performedAt: new Date(),
        summary: "Done",
      });
      const closed = await getDb().followUp.findUniqueOrThrow({
        where: { id: first!.followUpId! },
      });
      expect(closed).toMatchObject({ status: "done", completedById: technician.actor.id });
      expect(await generateDueReminders(new Date(), 7, ids)).toEqual({
        created: 0,
        alreadyRaised: 0,
      });

      // A month later the next visit is due, and one more reminder appears.
      const later = new Date(Date.now() + 31 * DAY);
      expect(await generateDueReminders(later, 7, ids)).toEqual({ created: 1, alreadyRaised: 0 });
      expect(await followUpsOf(schedule.id)).toHaveLength(2);
      expect((await getContract(sales.ctx, contract.id, later)).schedules[0]!.state).not.toBe(
        "finished",
      );
    });

    it("stops raising reminders once the contract has ended", async () => {
      const { schedule } = await contractWithSchedule(10, 1);
      const afterEnd = new Date(Date.now() + 400 * DAY);
      expect(await generateDueReminders(afterEnd, 7, [schedule.id])).toEqual({
        created: 0,
        alreadyRaised: 0,
      });
    });

    it("lists what needs doing now, and the manual trigger is idempotent too", async () => {
      const { schedule, contract } = await contractWithSchedule(-6);
      const due = await listDueMaintenance(sales.ctx);
      const mine = due.find((d) => d.scheduleId === schedule.id);
      expect(mine).toMatchObject({ state: "overdue", contractId: contract.id });
      const run = await generateRemindersNow(owner.ctx);
      expect(run.created + run.alreadyRaised).toBeGreaterThan(0);
      const again = await generateDueReminders(new Date(), 7, [schedule.id]);
      expect(again.created).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("database guarantees (bypassing the application)", () => {
    const raw = (sql: string, ...args: unknown[]) => getDb().$executeRawUnsafe(sql, ...args);

    it("ticket rules hold without the application", async () => {
      const customer = await newCustomer();
      const ticket = await createTicket(sales.ctx, { customerId: customer.id, title: "Raw" });
      await expect(
        raw(
          `UPDATE "ticket" SET "status" = 'resolved', "resolvedAt" = now() WHERE id = $1`,
          ticket.id,
        ),
      ).rejects.toThrow(/resolution_when_resolved/);
      await expect(
        raw(`UPDATE "ticket" SET "number" = 'T-0000-0000' WHERE id = $1`, ticket.id),
      ).rejects.toThrow(/identity/);
      await expect(raw(`DELETE FROM "ticket" WHERE id = $1`, ticket.id)).rejects.toThrow(
        /cannot be deleted/,
      );
      await changeTicketStatus(sales.ctx, ticket.id, { to: "closed" });
      await expect(
        raw(`UPDATE "ticket" SET "title" = 'Edited' WHERE id = $1`, ticket.id),
      ).rejects.toThrow(/final/);
      await expect(
        raw(
          `INSERT INTO "ticket_comment" ("id","ticketId","body") VALUES (gen_random_uuid()::text, $1, 'late')`,
          ticket.id,
        ),
      ).rejects.toThrow(/closed ticket/);
    });

    it("a ticket cannot jump along a path the state machine forbids", async () => {
      const customer = await newCustomer();
      const ticket = await createTicket(sales.ctx, { customerId: customer.id, title: "Path" });
      await changeTicketStatus(sales.ctx, ticket.id, { to: "in_progress" });
      await expect(
        raw(`UPDATE "ticket" SET "status" = 'closed', "closedAt" = now() WHERE id = $1`, ticket.id),
      ).rejects.toThrow(/invalid ticket status change/);
    });

    it("contracts only cover their own customer's assets, and an asset keeps its customer", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const foreign = await newAsset(b.id);
      const contract = await createContract(sales.ctx, {
        customerId: a.id,
        title: "Raw",
        startsAt: inDays(-1),
        endsAt: inDays(10),
      });
      await expect(
        raw(
          `INSERT INTO "contract_asset" ("contractId","assetId") VALUES ($1,$2)`,
          contract.id,
          foreign.id,
        ),
      ).rejects.toThrow(/own customer/);
      await expect(
        raw(`UPDATE "asset" SET "customerId" = $2 WHERE id = $1`, foreign.id, a.id),
      ).rejects.toThrow(/another customer/);
      await expect(
        raw(`UPDATE "maintenance_contract" SET "customerId" = $2 WHERE id = $1`, contract.id, b.id),
      ).rejects.toThrow(/another customer/);
      await expect(
        raw(
          `UPDATE "maintenance_contract" SET "endsAt" = "startsAt" - interval '1 day' WHERE id = $1`,
          contract.id,
        ),
      ).rejects.toThrow(/dates_ordered/);
    });

    it("rejects impossible schedule values and duplicate reminders", async () => {
      const { schedule } = await contractWithSchedule(5);
      await expect(
        raw(`UPDATE "maintenance_schedule" SET "intervalMonths" = 0 WHERE id = $1`, schedule.id),
      ).rejects.toThrow(/interval_range/);
      await generateDueReminders(new Date(), 7, [schedule.id]);
      const reminder = await getDb().maintenanceReminder.findFirstOrThrow({
        where: { scheduleId: schedule.id },
      });
      await expect(
        raw(
          `INSERT INTO "maintenance_reminder" ("id","scheduleId","dueDate") VALUES (gen_random_uuid()::text, $1, $2)`,
          schedule.id,
          reminder.dueDate,
        ),
      ).rejects.toThrow();
    });
  });
});
