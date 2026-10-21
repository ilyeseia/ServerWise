import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logCommunication, listCommunications } from "@/modules/crm/communications";
import {
  addContact,
  archiveCustomer,
  createCustomer,
  deleteContact,
  getCustomer,
  listCustomers,
  restoreCustomer,
  setPrimaryContact,
  updateContact,
  updateCustomer,
} from "@/modules/crm/customers";
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  listFollowUps,
  reopenFollowUp,
} from "@/modules/crm/followups";
import {
  changeLeadStatus,
  createLead,
  getLead,
  listAssignableUsers,
  listLeads,
  updateLead,
} from "@/modules/crm/leads";
import { getCrmStats } from "@/modules/crm/stats";
import type { CustomerInput } from "@/modules/crm/schemas";
import { getRequirements, saveRequirements } from "@/modules/questionnaire/service";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { deleteTestUsers } from "./helpers";
import {
  auditCount,
  createStaff,
  deleteCustomers,
  randomPhone,
  unique,
  type TestStaff,
} from "./crm-helpers";

const customerIds: string[] = [];
let owner: TestStaff;
let sales: TestStaff;
let technician: TestStaff;
let viewer: TestStaff;

const newCustomer = async (over: Partial<CustomerInput> = {}) => {
  const customer = await createCustomer(sales.ctx, {
    type: "individual",
    name: unique("Customer"),
    phone: randomPhone(),
    ...over,
  });
  customerIds.push(customer.id);
  return customer;
};

const anonymous = { actor: undefined };

describe.skipIf(!process.env.DATABASE_URL)("CRM (integration)", () => {
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
    it("every CRM operation rejects anonymous callers", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Auth probe" });
      const calls: Record<string, () => Promise<unknown>> = {
        listCustomers: () => listCustomers(anonymous),
        getCustomer: () => getCustomer(anonymous, customer.id),
        createCustomer: () => createCustomer(anonymous, { type: "individual", name: "Nobody" }),
        updateCustomer: () =>
          updateCustomer(anonymous, customer.id, { type: "individual", name: "Nobody" }),
        archiveCustomer: () => archiveCustomer(anonymous, customer.id),
        addContact: () => addContact(anonymous, customer.id, { name: "Nobody" }),
        listLeads: () => listLeads(anonymous),
        getLead: () => getLead(anonymous, lead.id),
        createLead: () => createLead(anonymous, { customerId: customer.id, title: "Nobody" }),
        changeLeadStatus: () => changeLeadStatus(anonymous, lead.id, "contacted"),
        listFollowUps: () => listFollowUps(anonymous),
        createFollowUp: () =>
          createFollowUp(anonymous, {
            customerId: customer.id,
            title: "Nobody",
            dueAt: new Date().toISOString(),
          }),
        logCommunication: () =>
          logCommunication(anonymous, {
            customerId: customer.id,
            channel: "call",
            direction: "inbound",
            occurredAt: new Date().toISOString(),
            summary: "Nobody",
          }),
        listCommunications: () => listCommunications(anonymous, { customerId: customer.id }),
        getRequirements: () => getRequirements(anonymous, lead.id),
        saveRequirements: () => saveRequirements(anonymous, lead.id, {}, { complete: false }),
        getCrmStats: () => getCrmStats(anonymous),
        listAssignableUsers: () => listAssignableUsers(anonymous),
      };
      for (const [name, call] of Object.entries(calls)) {
        await expect(call(), name).rejects.toBeInstanceOf(UnauthorizedError);
      }
    });

    it("viewers cannot read or write any CRM data", async () => {
      const customer = await newCustomer();
      await expect(listCustomers(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCustomer(viewer.ctx, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listLeads(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listFollowUps(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCrmStats(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createCustomer(viewer.ctx, { type: "individual", name: "Blocked Viewer" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("technicians can read but never write", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Tech probe" });

      await expect(listCustomers(technician.ctx)).resolves.toBeTruthy();
      await expect(getCustomer(technician.ctx, customer.id)).resolves.toBeTruthy();
      await expect(listLeads(technician.ctx)).resolves.toBeTruthy();
      await expect(getRequirements(technician.ctx, lead.id)).resolves.toBeTruthy();
      await expect(getCrmStats(technician.ctx)).resolves.toBeTruthy();

      const writes: Array<() => Promise<unknown>> = [
        () => createCustomer(technician.ctx, { type: "individual", name: "Blocked Tech" }),
        () => updateCustomer(technician.ctx, customer.id, { type: "individual", name: "Renamed" }),
        () => addContact(technician.ctx, customer.id, { name: "Blocked Tech" }),
        () => createLead(technician.ctx, { customerId: customer.id, title: "Blocked" }),
        () => updateLead(technician.ctx, lead.id, { title: "Blocked", source: "other" }),
        () => changeLeadStatus(technician.ctx, lead.id, "contacted"),
        () =>
          createFollowUp(technician.ctx, {
            customerId: customer.id,
            title: "Blocked",
            dueAt: new Date().toISOString(),
          }),
        () =>
          logCommunication(technician.ctx, {
            customerId: customer.id,
            channel: "call",
            direction: "inbound",
            occurredAt: new Date().toISOString(),
            summary: "Blocked",
          }),
        () => saveRequirements(technician.ctx, lead.id, {}, { complete: false }),
      ];
      for (const [i, write] of writes.entries()) {
        await expect(write(), `write #${i}`).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect((await getCustomer(sales.ctx, customer.id)).name).toBe(customer.name);
    });

    it("only the owner may archive or restore customers", async () => {
      const customer = await newCustomer();
      await expect(archiveCustomer(sales.ctx, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archiveCustomer(technician.ctx, customer.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await archiveCustomer(owner.ctx, customer.id);
      await expect(restoreCustomer(sales.ctx, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
      await restoreCustomer(owner.ctx, customer.id);
    });

    it("lists only users who can write CRM data as assignable", async () => {
      const assignable = await listAssignableUsers(sales.ctx);
      const ids = assignable.map((u) => u.id);
      expect(ids).toEqual(expect.arrayContaining([owner.actor.id, sales.actor.id]));
      expect(ids).not.toContain(technician.actor.id);
      expect(ids).not.toContain(viewer.actor.id);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("customers and contacts", () => {
    it("creates, reads, updates and audits a customer", async () => {
      const name = unique("Business");
      const customer = await createCustomer(sales.ctx, {
        type: "business",
        name,
        legalName: "SARL Test",
        taxId: "099919010123456",
        phone: "0555 12 34 56",
        email: "  Contact@Example.TEST ",
        wilayaCode: "19",
        preferredLanguage: "fr",
        notes: "Imprimerie à Sétif",
      });
      customerIds.push(customer.id);

      expect(customer).toMatchObject({
        type: "business",
        status: "prospect",
        email: "contact@example.test",
        wilayaCode: 19,
        preferredLanguage: "fr",
        createdById: sales.actor.id,
      });
      expect(await auditCount("customer.created", customer.id)).toBe(1);

      await updateCustomer(sales.ctx, customer.id, {
        type: "business",
        name,
        legalName: "SARL Test",
        phone: "0661 00 00 00",
        email: "contact@example.test",
        wilayaCode: 19,
        preferredLanguage: "fr",
      });
      const updated = await getCustomer(sales.ctx, customer.id);
      expect(updated.phone).toBe("0661 00 00 00");
      expect(updated.taxId).toBeNull(); // cleared fields become null
      expect(updated.notes).toBeNull();

      const audit = await getDb().auditLog.findFirstOrThrow({
        where: { action: "customer.updated", entityId: customer.id },
      });
      expect(audit.actorEmail).toBe(sales.actor.email);
      expect(audit.ip).toBe("203.0.113.5");
      expect((audit.metadata as { changed: string[] }).changed).toEqual(
        expect.arrayContaining(["phone", "taxId", "notes"]),
      );
    });

    it("rejects invalid input before touching the database", async () => {
      // Count only the records this test could create: other test files run in parallel on the
      // same database, so a table-wide count is not stable.
      const mine = { name: { in: ["x", "Valid Name"] } };
      const before = await getDb().customer.count({ where: mine });
      await expect(createCustomer(sales.ctx, { type: "individual", name: "x" })).rejects.toThrow();
      await expect(
        createCustomer(sales.ctx, { type: "individual", name: "Valid Name", phone: "abc" }),
      ).rejects.toThrow();
      await expect(
        createCustomer(sales.ctx, { type: "individual", name: "Valid Name", wilayaCode: 99 }),
      ).rejects.toThrow();
      expect(await getDb().customer.count({ where: mine })).toBe(before);
    });

    it("reports missing customers", async () => {
      await expect(getCustomer(sales.ctx, "does-not-exist")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("searches by name, phone and e-mail, case-insensitively, and paginates", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const phones = [randomPhone(), randomPhone(), randomPhone()];
      for (const [i, phone] of phones.entries()) {
        await newCustomer({
          name: `ZZ Search ${token} ${i}`,
          phone,
          email: `s${i}-${token}@example.test`,
        });
      }

      const byName = await listCustomers(sales.ctx, { q: token.toUpperCase(), pageSize: 2 });
      expect(byName.total).toBe(3);
      expect(byName.items).toHaveLength(2);
      const second = await listCustomers(sales.ctx, { q: token, pageSize: 2, page: 2 });
      expect(second.items).toHaveLength(1);
      expect(new Set([...byName.items, ...second.items].map((c) => c.id)).size).toBe(3);

      expect((await listCustomers(sales.ctx, { q: phones[1]! })).items.map((c) => c.phone)).toEqual(
        [phones[1]],
      );
      expect((await listCustomers(sales.ctx, { q: `s2-${token}@EXAMPLE` })).total).toBe(1);
      expect((await listCustomers(sales.ctx, { q: `${token}-no-match` })).total).toBe(0);
    });

    it("filters by type and status, and hides archived customers by default", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const person = await newCustomer({ name: `ZZ Filter ${token} person`, type: "individual" });
      const firm = await newCustomer({ name: `ZZ Filter ${token} firm`, type: "business" });
      await archiveCustomer(owner.ctx, firm.id);

      const visible = await listCustomers(sales.ctx, { q: token });
      expect(visible.items.map((c) => c.id)).toEqual([person.id]);
      expect(
        (await listCustomers(sales.ctx, { q: token, status: "archived" })).items.map((c) => c.id),
      ).toEqual([firm.id]);
      expect((await listCustomers(sales.ctx, { q: token, type: "business" })).total).toBe(0);
      expect(
        (await listCustomers(sales.ctx, { q: token, status: "archived", type: "business" })).total,
      ).toBe(1);
    });

    it("clamps page size and rejects nonsense paging", async () => {
      await expect(listCustomers(sales.ctx, { pageSize: 1000 })).rejects.toThrow();
      await expect(listCustomers(sales.ctx, { page: 0 })).rejects.toThrow();
    });

    it("makes the first contact primary and keeps exactly one primary", async () => {
      const customer = await newCustomer();
      const first = await addContact(sales.ctx, customer.id, { name: "First Contact" });
      expect(first.isPrimary).toBe(true);

      const second = await addContact(sales.ctx, customer.id, { name: "Second Contact" });
      expect(second.isPrimary).toBe(false);

      const third = await addContact(sales.ctx, customer.id, {
        name: "Third Contact",
        isPrimary: true,
      });
      expect(third.isPrimary).toBe(true);
      let contacts = (await getCustomer(sales.ctx, customer.id)).contacts;
      expect(contacts.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([third.id]);
      expect(contacts[0]?.id).toBe(third.id); // primary listed first

      await setPrimaryContact(sales.ctx, second.id);
      contacts = (await getCustomer(sales.ctx, customer.id)).contacts;
      expect(contacts.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([second.id]);

      // Demoting through an edit is ignored: another contact must be chosen as primary.
      await updateContact(sales.ctx, second.id, { name: "Second Contact", isPrimary: false });
      expect(
        (await getCustomer(sales.ctx, customer.id)).contacts.filter((c) => c.isPrimary),
      ).toHaveLength(1);

      // Deleting the primary promotes the oldest remaining contact.
      await deleteContact(sales.ctx, second.id);
      contacts = (await getCustomer(sales.ctx, customer.id)).contacts;
      expect(contacts).toHaveLength(2);
      expect(contacts.filter((c) => c.isPrimary)).toHaveLength(1);
      expect(contacts.find((c) => c.isPrimary)?.id).toBe(first.id);
    });

    it("the database itself refuses a second primary contact", async () => {
      const customer = await newCustomer();
      await addContact(sales.ctx, customer.id, { name: "Primary One" });
      await expect(
        getDb().contact.create({
          data: { customerId: customer.id, name: "Primary Two", isPrimary: true },
        }),
      ).rejects.toThrow();
    });

    it("blocks archiving while a lead is open, then archives and restores", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Open lead" });
      await expect(archiveCustomer(owner.ctx, customer.id)).rejects.toMatchObject({
        code: "HAS_OPEN_LEADS",
      });

      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "No budget" });
      await archiveCustomer(owner.ctx, customer.id);
      const archived = await getDb().customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(archived.status).toBe("archived");
      expect(archived.archivedAt).not.toBeNull();
      expect(await auditCount("customer.archived", customer.id)).toBe(1);

      // Archiving again is a no-op (idempotent, no duplicate audit row).
      await archiveCustomer(owner.ctx, customer.id);
      expect(await auditCount("customer.archived", customer.id)).toBe(1);

      await restoreCustomer(owner.ctx, customer.id);
      const restored = await getDb().customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(restored.status).toBe("prospect"); // never won work
      expect(restored.archivedAt).toBeNull();
    });

    it("restores a customer who won work as active", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Won deal" });
      for (const to of ["contacted", "qualified", "proposal", "won"] as const) {
        await changeLeadStatus(sales.ctx, lead.id, to);
      }
      expect((await getCustomer(sales.ctx, customer.id)).status).toBe("active");
      await archiveCustomer(owner.ctx, customer.id);
      await restoreCustomer(owner.ctx, customer.id);
      expect((await getCustomer(sales.ctx, customer.id)).status).toBe("active");
    });

    it("an archived customer is read-only everywhere", async () => {
      const customer = await newCustomer();
      await archiveCustomer(owner.ctx, customer.id);
      const archivedError = { code: "CUSTOMER_ARCHIVED" };
      await expect(
        updateCustomer(sales.ctx, customer.id, { type: "individual", name: "Renamed" }),
      ).rejects.toMatchObject(archivedError);
      await expect(
        addContact(sales.ctx, customer.id, { name: "New Contact" }),
      ).rejects.toMatchObject(archivedError);
      await expect(
        createLead(sales.ctx, { customerId: customer.id, title: "New lead" }),
      ).rejects.toMatchObject(archivedError);
      await expect(
        createFollowUp(sales.ctx, {
          customerId: customer.id,
          title: "Call",
          dueAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject(archivedError);
      await expect(
        logCommunication(sales.ctx, {
          customerId: customer.id,
          channel: "call",
          direction: "outbound",
          occurredAt: new Date().toISOString(),
          summary: "Should not be saved",
        }),
      ).rejects.toMatchObject(archivedError);
    });

    it("database CHECK constraints reject impossible customer data", async () => {
      const db = getDb();
      await expect(
        db.customer.create({ data: { type: "individual", name: "Bad Wilaya", wilayaCode: 99 } }),
      ).rejects.toThrow();
      await expect(
        db.customer.create({ data: { type: "individual", name: "   " } }),
      ).rejects.toThrow();
      // 'archived' status without an archive date is inconsistent.
      await expect(
        db.customer.create({
          data: { type: "individual", name: "Bad Archive", status: "archived" },
        }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("leads", () => {
    it("creates a lead owned by the creator, with decimal budgets, and audits it", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, {
        customerId: customer.id,
        title: "Serveur maison",
        source: "ouedkniss",
        budgetMinDzd: "120000.50",
        budgetMaxDzd: 200000,
      });
      expect(lead).toMatchObject({
        status: "new",
        source: "ouedkniss",
        ownerId: sales.actor.id,
        createdById: sales.actor.id,
      });
      expect(lead.budgetMinDzd?.toString()).toBe("120000.5");
      expect(lead.budgetMaxDzd?.toString()).toBe("200000");
      expect(await auditCount("lead.created", lead.id)).toBe(1);

      const detail = await getLead(sales.ctx, lead.id);
      expect(detail.customer.id).toBe(customer.id);
      expect(detail.owner?.name).toBe("Test sales");
    });

    it("rejects owners who cannot work on leads and unknown customers", async () => {
      const customer = await newCustomer();
      await expect(
        createLead(sales.ctx, {
          customerId: customer.id,
          title: "Wrong owner",
          ownerId: viewer.actor.id,
        }),
      ).rejects.toMatchObject({ code: "INVALID_OWNER" });
      await expect(
        createLead(sales.ctx, {
          customerId: customer.id,
          title: "Wrong owner",
          ownerId: technician.actor.id,
        }),
      ).rejects.toMatchObject({ code: "INVALID_OWNER" });
      await expect(
        createLead(sales.ctx, { customerId: crypto.randomUUID(), title: "Ghost customer" }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("walks the pipeline, activates the customer on win, and audits each step", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Full pipeline" });

      await changeLeadStatus(sales.ctx, lead.id, "contacted");
      await changeLeadStatus(sales.ctx, lead.id, "qualified");
      await changeLeadStatus(sales.ctx, lead.id, "proposal");
      expect((await getCustomer(sales.ctx, customer.id)).status).toBe("prospect");
      const won = await changeLeadStatus(sales.ctx, lead.id, "won");

      expect(won.status).toBe("won");
      expect(won.closedAt).not.toBeNull();
      expect((await getCustomer(sales.ctx, customer.id)).status).toBe("active");

      const changes = await getDb().auditLog.findMany({
        where: { action: "lead.status_changed", entityId: lead.id },
        orderBy: { createdAt: "asc" },
      });
      expect(changes.map((c) => c.metadata)).toEqual([
        { from: "new", to: "contacted" },
        { from: "contacted", to: "qualified" },
        { from: "qualified", to: "proposal" },
        { from: "proposal", to: "won" },
      ]);
    });

    it("refuses transitions the state machine does not allow", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Skipper" });
      await expect(changeLeadStatus(sales.ctx, lead.id, "won")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      await expect(changeLeadStatus(sales.ctx, lead.id, "proposal")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      await expect(changeLeadStatus(sales.ctx, lead.id, "new")).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      expect((await getLead(sales.ctx, lead.id)).status).toBe("new");
      expect(await auditCount("lead.status_changed", lead.id)).toBe(0);
    });

    it("requires a reason to lose a lead, stores it, and reopening clears it", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Lost cause" });

      await expect(changeLeadStatus(sales.ctx, lead.id, "lost")).rejects.toMatchObject({
        code: "LOST_REASON_REQUIRED",
      });
      await expect(
        changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "   " }),
      ).rejects.toMatchObject({
        code: "LOST_REASON_REQUIRED",
      });

      const lost = await changeLeadStatus(sales.ctx, lead.id, "lost", {
        lostReason: " Budget too low ",
      });
      expect(lost).toMatchObject({ status: "lost", lostReason: "Budget too low" });
      expect(lost.closedAt).not.toBeNull();
      expect((await getCustomer(sales.ctx, customer.id)).status).toBe("prospect"); // losing does not activate

      const reopened = await changeLeadStatus(sales.ctx, lead.id, "contacted");
      expect(reopened).toMatchObject({ status: "contacted", lostReason: null, closedAt: null });
    });

    it("won leads are final", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Final" });
      for (const to of ["contacted", "qualified", "proposal", "won"] as const) {
        await changeLeadStatus(sales.ctx, lead.id, to);
      }
      for (const to of ["new", "contacted", "qualified", "proposal", "lost"] as const) {
        await expect(
          changeLeadStatus(sales.ctx, lead.id, to, { lostReason: "x".repeat(5) }),
          to,
        ).rejects.toMatchObject({
          code: "INVALID_TRANSITION",
        });
      }
    });

    it("closed leads cannot be edited; open ones can", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Editable" });
      await updateLead(sales.ctx, lead.id, {
        title: "Edited title",
        source: "referral",
        budgetMaxDzd: 90000,
      });
      expect(await getLead(sales.ctx, lead.id)).toMatchObject({
        title: "Edited title",
        source: "referral",
      });
      expect(await auditCount("lead.updated", lead.id)).toBe(1);

      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "Went elsewhere" });
      await expect(
        updateLead(sales.ctx, lead.id, { title: "Too late", source: "other" }),
      ).rejects.toMatchObject({
        code: "LEAD_CLOSED",
      });
    });

    it("rejects a budget range where the maximum is below the minimum", async () => {
      const customer = await newCustomer();
      await expect(
        createLead(sales.ctx, {
          customerId: customer.id,
          title: "Bad range",
          budgetMinDzd: 500,
          budgetMaxDzd: 100,
        }),
      ).rejects.toThrow();
    });

    it("database CHECK constraints reject impossible lead data", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, {
        customerId: customer.id,
        title: "Constraint probe",
      });
      const db = getDb();

      // lost without a reason
      await expect(
        db.lead.update({ where: { id: lead.id }, data: { status: "lost", closedAt: new Date() } }),
      ).rejects.toThrow();
      // closed without a close date / open with a close date
      await expect(
        db.lead.update({ where: { id: lead.id }, data: { status: "won" } }),
      ).rejects.toThrow();
      await expect(
        db.lead.update({ where: { id: lead.id }, data: { closedAt: new Date() } }),
      ).rejects.toThrow();
      // inverted and negative budgets
      await expect(
        db.lead.update({ where: { id: lead.id }, data: { budgetMinDzd: 10, budgetMaxDzd: 5 } }),
      ).rejects.toThrow();
      await expect(
        db.lead.update({ where: { id: lead.id }, data: { budgetMinDzd: -1 } }),
      ).rejects.toThrow();

      expect((await getLead(sales.ctx, lead.id)).status).toBe("new");
    });

    it("lists and filters leads", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const customer = await newCustomer({ name: `ZZ Leads ${token}` });
      const a = await createLead(sales.ctx, { customerId: customer.id, title: `Alpha ${token}` });
      const b = await createLead(owner.ctx, { customerId: customer.id, title: `Beta ${token}` });
      await changeLeadStatus(sales.ctx, a.id, "contacted");

      expect((await listLeads(sales.ctx, { q: token })).total).toBe(2);
      expect(
        (await listLeads(sales.ctx, { q: token, status: "contacted" })).items.map((l) => l.id),
      ).toEqual([a.id]);
      expect(
        (
          await listLeads(sales.ctx, { customerId: customer.id, ownerId: owner.actor.id })
        ).items.map((l) => l.id),
      ).toEqual([b.id]);
      const row = (await listLeads(sales.ctx, { customerId: customer.id })).items[0]!;
      expect(row.customerName).toBe(customer.name);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("follow-ups", () => {
    const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

    it("creates a follow-up assigned to the creator by default and audits it", async () => {
      const customer = await newCustomer();
      const followUp = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Call back",
        dueAt: inHours(24),
      });
      expect(followUp).toMatchObject({
        status: "open",
        assignedToId: sales.actor.id,
        createdById: sales.actor.id,
      });
      expect(await auditCount("followup.created", followUp.id)).toBe(1);
    });

    it("flags overdue items and lists by scope", async () => {
      const customer = await newCustomer();
      const late = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Late one",
        dueAt: inHours(-48),
      });
      const later = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Future one",
        dueAt: inHours(48),
      });
      const theirs = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Owner task",
        dueAt: inHours(-1),
        assignedToId: owner.actor.id,
      });

      const mine = await listFollowUps(sales.ctx, { scope: "mine", customerId: customer.id });
      expect(mine.items.map((f) => f.id)).toEqual([late.id, later.id]); // soonest first
      expect(mine.items.map((f) => f.overdue)).toEqual([true, false]);

      const all = await listFollowUps(sales.ctx, { scope: "all", customerId: customer.id });
      expect(all.total).toBe(3);
      expect(
        (
          await listFollowUps(sales.ctx, {
            scope: "all",
            customerId: customer.id,
            overdueOnly: true,
          })
        ).items.map((f) => f.id),
      ).toEqual([late.id, theirs.id]);
    });

    it("completes, cancels and reopens with valid transitions only", async () => {
      const customer = await newCustomer();
      const f = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Transitions",
        dueAt: inHours(1),
      });

      await expect(reopenFollowUp(sales.ctx, f.id)).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      }); // already open

      const done = await completeFollowUp(sales.ctx, f.id);
      expect(done).toMatchObject({ status: "done", completedById: sales.actor.id });
      expect(done.completedAt).not.toBeNull();
      await expect(completeFollowUp(sales.ctx, f.id)).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });
      await expect(cancelFollowUp(sales.ctx, f.id)).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
      });

      const reopened = await reopenFollowUp(sales.ctx, f.id);
      expect(reopened).toMatchObject({ status: "open", completedAt: null, completedById: null });

      const cancelled = await cancelFollowUp(sales.ctx, f.id);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.completedAt).toBeNull();

      for (const action of [
        "followup.created",
        "followup.completed",
        "followup.reopened",
        "followup.cancelled",
      ]) {
        expect(await auditCount(action, f.id), action).toBe(1);
      }
    });

    it("done follow-ups do not count as overdue", async () => {
      const customer = await newCustomer();
      const f = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Finished late",
        dueAt: inHours(-5),
      });
      await completeFollowUp(sales.ctx, f.id);
      const done = await listFollowUps(sales.ctx, { customerId: customer.id, status: "done" });
      expect(done.items[0]).toMatchObject({ id: f.id, overdue: false });
      expect(
        (await listFollowUps(sales.ctx, { customerId: customer.id, overdueOnly: true })).total,
      ).toBe(0);
    });

    it("keeps a follow-up's lead consistent with its customer", async () => {
      const customerA = await newCustomer();
      const customerB = await newCustomer();
      const leadB = await createLead(sales.ctx, { customerId: customerB.id, title: "B's lead" });
      await expect(
        createFollowUp(sales.ctx, {
          customerId: customerA.id,
          leadId: leadB.id,
          title: "Mismatch",
          dueAt: inHours(1),
        }),
      ).rejects.toMatchObject({ code: "LEAD_CUSTOMER_MISMATCH" });
      await expect(
        createFollowUp(sales.ctx, {
          customerId: customerA.id,
          title: "Bad assignee",
          dueAt: inHours(1),
          assignedToId: viewer.actor.id,
        }),
      ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
    });

    it("rejects invalid dates", async () => {
      const customer = await newCustomer();
      await expect(
        createFollowUp(sales.ctx, { customerId: customer.id, title: "No date", dueAt: "" }),
      ).rejects.toThrow();
      await expect(
        createFollowUp(sales.ctx, { customerId: customer.id, title: "Bad date", dueAt: "soon" }),
      ).rejects.toThrow();
    });

    it("the database refuses a 'done' follow-up without a completion time", async () => {
      const customer = await newCustomer();
      const f = await createFollowUp(sales.ctx, {
        customerId: customer.id,
        title: "Inconsistent",
        dueAt: inHours(1),
      });
      await expect(
        getDb().followUp.update({ where: { id: f.id }, data: { status: "done" } }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("communications", () => {
    it("logs a conversation, newest first, with its author and lead", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Talks" });
      const older = await logCommunication(sales.ctx, {
        customerId: customer.id,
        channel: "whatsapp",
        direction: "inbound",
        occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        summary: "Asked about NAS prices",
      });
      const newer = await logCommunication(owner.ctx, {
        customerId: customer.id,
        leadId: lead.id,
        channel: "call",
        direction: "outbound",
        occurredAt: new Date(Date.now() - 3600_000).toISOString(),
        summary: "Sent a quote outline",
      });

      const all = await listCommunications(sales.ctx, { customerId: customer.id });
      expect(all.map((c) => c.id)).toEqual([newer.id, older.id]);
      expect(all[0]).toMatchObject({
        leadTitle: "Talks",
        authorName: "Test owner",
        direction: "outbound",
      });
      expect((await listCommunications(sales.ctx, { leadId: lead.id })).map((c) => c.id)).toEqual([
        newer.id,
      ]);
      expect(await auditCount("communication.logged", newer.id)).toBe(1);
    });

    it("rejects future dates and lead/customer mismatches", async () => {
      const customerA = await newCustomer();
      const customerB = await newCustomer();
      const leadB = await createLead(sales.ctx, { customerId: customerB.id, title: "Lead of B" });
      const base = {
        channel: "call",
        direction: "inbound",
        summary: "Something happened",
      } as const;

      await expect(
        logCommunication(sales.ctx, {
          ...base,
          customerId: customerA.id,
          occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: "FUTURE_DATE" });
      await expect(
        logCommunication(sales.ctx, {
          ...base,
          customerId: customerA.id,
          leadId: leadB.id,
          occurredAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "LEAD_CUSTOMER_MISMATCH" });
      expect(await listCommunications(sales.ctx, { customerId: customerA.id })).toHaveLength(0);
    });

    it("is append-only at the database level", async () => {
      const customer = await newCustomer();
      const entry = await logCommunication(sales.ctx, {
        customerId: customer.id,
        channel: "email",
        direction: "outbound",
        occurredAt: new Date().toISOString(),
        summary: "Original text",
      });
      const db = getDb();
      await expect(
        db.communication.update({
          where: { id: entry.id },
          data: { summary: "Rewritten history" },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(db.communication.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/,
      );
      expect((await db.communication.findUniqueOrThrow({ where: { id: entry.id } })).summary).toBe(
        "Original text",
      );
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("requirements questionnaire", () => {
    const complete = {
      workloads: ["file_storage", "surveillance"],
      concurrentUsers: 4,
      cameraCount: 6,
      budgetMinDzd: 100000,
      budgetMaxDzd: 250000,
      cpuPriority: "balanced",
      storageTb: 8,
      redundancy: "mirror",
      alwaysOn: true,
      maxPowerWatts: 60,
      noiseLevel: "quiet",
      needsRemoteAccess: true,
      remoteMethod: "tailscale",
      publicExposure: false,
      needsBackup: true,
      offsiteBackup: true,
      rpoHours: "24",
      growth2y: "some",
    };

    it("starts empty on the latest version", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });
      const view = await getRequirements(sales.ctx, lead.id);
      expect(view).toMatchObject({ saved: false, status: "draft", answers: {}, updatedAt: null });
      expect(view.definition.version).toBe(1);
    });

    it("saves a draft with partial answers, then a complete response", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });

      const draft = await saveRequirements(
        sales.ctx,
        lead.id,
        { workloads: ["media"], concurrentUsers: 2 },
        { complete: false },
      );
      expect(draft).toMatchObject({ ok: true, status: "draft" });
      expect(await getRequirements(sales.ctx, lead.id)).toMatchObject({
        saved: true,
        status: "draft",
        answers: { workloads: ["media"], concurrentUsers: 2 },
      });

      const done = await saveRequirements(sales.ctx, lead.id, complete, { complete: true });
      expect(done).toMatchObject({ ok: true, status: "complete" });
      const view = await getRequirements(sales.ctx, lead.id);
      expect(view.status).toBe("complete");
      expect(view.answers).toMatchObject({
        cameraCount: 6,
        remoteMethod: "tailscale",
        budgetMaxDzd: 250000,
      });
      expect(await auditCount("requirements.saved", lead.id)).toBe(2);
    });

    it("returns field errors without saving when completing an incomplete response", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });
      const result = await saveRequirements(
        sales.ctx,
        lead.id,
        { workloads: ["surveillance"] },
        { complete: true },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.cameraCount).toBe("required");
        expect(result.errors.concurrentUsers).toBe("required");
      }
      expect((await getRequirements(sales.ctx, lead.id)).saved).toBe(false);
      expect(await auditCount("requirements.saved", lead.id)).toBe(0);
    });

    it("drops answers that no longer apply when the user changes their mind", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });
      await saveRequirements(sales.ctx, lead.id, complete, { complete: true });

      await saveRequirements(
        sales.ctx,
        lead.id,
        { ...complete, needsRemoteAccess: false, workloads: ["file_storage"] },
        { complete: true },
      );
      const answers = (await getRequirements(sales.ctx, lead.id)).answers;
      expect(answers).not.toHaveProperty("remoteMethod");
      expect(answers).not.toHaveProperty("publicExposure");
      expect(answers).not.toHaveProperty("cameraCount");
    });

    it("pins the questionnaire version a response was started on", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });
      await saveRequirements(sales.ctx, lead.id, { concurrentUsers: 3 }, { complete: false });
      const row = await getDb().requirementsResponse.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
      expect(row.version).toBe(1);

      await getDb().requirementsResponse.update({
        where: { leadId: lead.id },
        data: { version: 999 },
      });
      await expect(getRequirements(sales.ctx, lead.id)).rejects.toMatchObject({
        code: "UNKNOWN_QUESTIONNAIRE_VERSION",
      });
      await expect(
        saveRequirements(sales.ctx, lead.id, {}, { complete: false }),
      ).rejects.toMatchObject({
        code: "UNKNOWN_QUESTIONNAIRE_VERSION",
      });
    });

    it("is read-only once the lead is closed", async () => {
      const customer = await newCustomer();
      const lead = await createLead(sales.ctx, { customerId: customer.id, title: "Needs" });
      await saveRequirements(sales.ctx, lead.id, { concurrentUsers: 3 }, { complete: false });
      await changeLeadStatus(sales.ctx, lead.id, "lost", { lostReason: "Chose a competitor" });
      await expect(
        saveRequirements(sales.ctx, lead.id, { concurrentUsers: 9 }, { complete: false }),
      ).rejects.toMatchObject({
        code: "LEAD_CLOSED",
      });
      expect((await getRequirements(sales.ctx, lead.id)).answers).toMatchObject({
        concurrentUsers: 3,
      });
    });

    it("reports a missing lead", async () => {
      await expect(getRequirements(sales.ctx, "ghost")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("dashboard statistics", () => {
    it("counts a user's own follow-ups exactly, and the global figures are consistent", async () => {
      const fresh = await createStaff("sales");
      try {
        const customer = await createCustomer(fresh.ctx, {
          type: "individual",
          name: unique("Stats"),
        });
        customerIds.push(customer.id);
        const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

        const empty = await getCrmStats(fresh.ctx);
        expect(empty.myOpenFollowUps).toBe(0);
        expect(empty.myOverdueFollowUps).toBe(0);

        const a = await createFollowUp(fresh.ctx, {
          customerId: customer.id,
          title: "Overdue",
          dueAt: hours(-2),
        });
        await createFollowUp(fresh.ctx, {
          customerId: customer.id,
          title: "Upcoming",
          dueAt: hours(5),
        });
        const c = await createFollowUp(fresh.ctx, {
          customerId: customer.id,
          title: "Done soon",
          dueAt: hours(-3),
        });
        await completeFollowUp(fresh.ctx, c.id);

        const stats = await getCrmStats(fresh.ctx);
        expect(stats.myOpenFollowUps).toBe(2);
        expect(stats.myOverdueFollowUps).toBe(1);
        expect(stats.overdueFollowUps).toBeGreaterThanOrEqual(1);
        expect(stats.openFollowUps).toBeGreaterThanOrEqual(2);
        expect(stats.newCustomersLast30Days).toBeGreaterThanOrEqual(1);
        expect(stats.customers.prospect).toBeGreaterThanOrEqual(1);

        const lead = await createLead(fresh.ctx, { customerId: customer.id, title: "Stat lead" });
        const afterLead = await getCrmStats(fresh.ctx);
        expect(afterLead.leadsByStatus.new).toBeGreaterThanOrEqual(1);
        expect(Object.keys(afterLead.leadsByStatus).sort()).toEqual([
          "contacted",
          "lost",
          "new",
          "proposal",
          "qualified",
          "won",
        ]);

        // "Now" is injectable, so overdue logic is testable without sleeping.
        const future = await getCrmStats(fresh.ctx, new Date(Date.now() + 10 * 3600_000));
        expect(future.myOverdueFollowUps).toBe(2);

        expect(lead.id).toBeTruthy();
        expect(a.id).toBeTruthy();
      } finally {
        await deleteTestUsers([fresh.user]);
      }
    });
  });
});
