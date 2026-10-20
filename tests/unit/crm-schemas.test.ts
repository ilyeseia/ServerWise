import { describe, expect, it } from "vitest";
import {
  communicationInput,
  contactInput,
  customerInput,
  followUpInput,
  leadInput,
  leadUpdateInput,
  pageInput,
} from "@/modules/crm/schemas";
import { WILAYAS, wilayaName } from "@/modules/crm/wilayas";

const uuid = "0190a5d3-7c1e-7a35-9d0b-5b8c2f1e4a67";

describe("customerInput", () => {
  const base = { type: "individual", name: "Amine Benali" } as const;

  it("accepts a minimal customer and applies defaults", () => {
    const parsed = customerInput.parse(base);
    expect(parsed.preferredLanguage).toBe("ar");
    expect(parsed.phone).toBeUndefined();
  });

  it("turns blank optional fields into undefined and trims text", () => {
    const parsed = customerInput.parse({
      ...base,
      name: "  Amine  ",
      phone: "   ",
      email: "",
      address: " ",
    });
    expect(parsed).toMatchObject({
      name: "Amine",
      phone: undefined,
      email: undefined,
      address: undefined,
    });
  });

  it("normalizes e-mail to lower case", () => {
    expect(customerInput.parse({ ...base, email: "  Amine@Example.COM " }).email).toBe(
      "amine@example.com",
    );
  });

  it("accepts Algerian phone formats and rejects junk", () => {
    for (const ok of [
      "0555 12 34 56",
      "+213 555 12 34 56",
      "036 12 34 56",
      "0770-12-34-56",
      "(0555) 123456",
    ]) {
      expect(customerInput.safeParse({ ...base, phone: ok }).success, ok).toBe(true);
    }
    for (const bad of ["abc", "12", "05<script>", "+", "0555 12 34 56 78 90 12 34 56 78"]) {
      expect(customerInput.safeParse({ ...base, phone: bad }).success, bad).toBe(false);
    }
  });

  it("rejects an invalid e-mail and a too-short name", () => {
    expect(customerInput.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(customerInput.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(customerInput.safeParse({ ...base, name: "   " }).success).toBe(false);
  });

  it("accepts wilaya codes 1..58 only (also as form strings)", () => {
    expect(customerInput.parse({ ...base, wilayaCode: "19" }).wilayaCode).toBe(19);
    expect(customerInput.parse({ ...base, wilayaCode: "" }).wilayaCode).toBeUndefined();
    for (const bad of [0, 59, -1, 1.5, "abc"]) {
      expect(customerInput.safeParse({ ...base, wilayaCode: bad }).success, String(bad)).toBe(
        false,
      );
    }
  });

  it("rejects unknown types and languages", () => {
    expect(customerInput.safeParse({ ...base, type: "alien" }).success).toBe(false);
    expect(customerInput.safeParse({ ...base, preferredLanguage: "en" }).success).toBe(false);
  });

  it("limits field lengths", () => {
    expect(customerInput.safeParse({ ...base, notes: "x".repeat(2001) }).success).toBe(false);
    expect(customerInput.safeParse({ ...base, name: "x".repeat(201) }).success).toBe(false);
  });
});

describe("contactInput", () => {
  it("requires a name and defaults isPrimary to false", () => {
    expect(contactInput.parse({ name: "Sara" }).isPrimary).toBe(false);
    expect(contactInput.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("leadInput / leadUpdateInput", () => {
  it("accepts budgets as numbers or form strings", () => {
    const parsed = leadInput.parse({
      customerId: uuid,
      title: "Home server",
      budgetMinDzd: "100000",
      budgetMaxDzd: 250000,
    });
    expect(parsed.budgetMinDzd).toBe(100000);
    expect(parsed.budgetMaxDzd).toBe(250000);
    expect(parsed.source).toBe("other");
  });

  it("rejects a maximum below the minimum, negative or absurd budgets", () => {
    expect(
      leadInput.safeParse({
        customerId: uuid,
        title: "Home server",
        budgetMinDzd: 200,
        budgetMaxDzd: 100,
      }).success,
    ).toBe(false);
    expect(
      leadInput.safeParse({ customerId: uuid, title: "Home server", budgetMinDzd: -1 }).success,
    ).toBe(false);
    expect(
      leadInput.safeParse({ customerId: uuid, title: "Home server", budgetMaxDzd: 1e12 }).success,
    ).toBe(false);
    expect(
      leadInput.safeParse({
        customerId: uuid,
        title: "Home server",
        budgetMinDzd: 100,
        budgetMaxDzd: 100,
      }).success,
    ).toBe(true);
  });

  it("requires a valid customer id and a title", () => {
    expect(leadInput.safeParse({ customerId: "x", title: "Home server" }).success).toBe(false);
    expect(leadInput.safeParse({ customerId: uuid, title: "x" }).success).toBe(false);
  });

  it("rejects unknown sources", () => {
    expect(leadUpdateInput.safeParse({ title: "Home server", source: "tv" }).success).toBe(false);
    expect(leadUpdateInput.safeParse({ title: "Home server", source: "ouedkniss" }).success).toBe(
      true,
    );
  });
});

describe("followUpInput / communicationInput", () => {
  it("parses ISO dates and rejects invalid ones", () => {
    const ok = followUpInput.parse({
      customerId: uuid,
      title: "Call back",
      dueAt: "2030-01-15T10:00:00.000Z",
    });
    expect(ok.dueAt).toBeInstanceOf(Date);
    expect(
      followUpInput.safeParse({ customerId: uuid, title: "Call back", dueAt: "not a date" })
        .success,
    ).toBe(false);
    expect(
      followUpInput.safeParse({ customerId: uuid, title: "Call back", dueAt: "" }).success,
    ).toBe(false);
  });

  it("validates communication channel, direction and summary", () => {
    const base = {
      customerId: uuid,
      channel: "whatsapp",
      direction: "inbound",
      occurredAt: "2026-01-01T10:00:00Z",
      summary: "Asked about NAS prices",
    };
    expect(communicationInput.safeParse(base).success).toBe(true);
    expect(communicationInput.safeParse({ ...base, channel: "pigeon" }).success).toBe(false);
    expect(communicationInput.safeParse({ ...base, direction: "sideways" }).success).toBe(false);
    expect(communicationInput.safeParse({ ...base, summary: "x" }).success).toBe(false);
  });
});

describe("pageInput", () => {
  it("defaults and clamps pagination", () => {
    expect(pageInput.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(pageInput.parse({ page: "3", pageSize: "50" })).toEqual({ page: 3, pageSize: 50 });
    expect(pageInput.safeParse({ page: 0 }).success).toBe(false);
    expect(pageInput.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe("wilayas", () => {
  it("lists the 58 wilayas with consecutive codes and unique names", () => {
    expect(WILAYAS).toHaveLength(58);
    expect(WILAYAS.map((w) => w.code)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
    expect(new Set(WILAYAS.map((w) => w.fr)).size).toBe(58);
    expect(new Set(WILAYAS.map((w) => w.ar)).size).toBe(58);
  });

  it("has Arabic script for every Arabic name and none for French ones", () => {
    for (const w of WILAYAS) {
      expect(w.ar, `ar ${w.code}`).toMatch(/[؀-ۿ]/);
      expect(w.fr, `fr ${w.code}`).not.toMatch(/[؀-ۿ]/);
    }
  });

  it("knows the home region", () => {
    expect(wilayaName(19, "fr")).toBe("19 · Sétif");
    expect(wilayaName(19, "ar")).toBe("19 · سطيف");
    expect(wilayaName(16, "fr")).toBe("16 · Alger");
    expect(wilayaName(null, "fr")).toBeNull();
    expect(wilayaName(99, "ar")).toBeNull();
  });
});
