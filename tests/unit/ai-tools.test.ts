import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_TOOLS, AI_TOOL_IDS, aiOutput, findTool } from "@/modules/ai/tools";
import { PERMISSIONS } from "@/server/authz/permissions";

const source = readFileSync("src/modules/ai/tools.ts", "utf8");

describe("the assistant cannot change anything (by construction)", () => {
  /**
   * The tools file may import only these READ functions. Anything else - a create, update, issue,
   * approve, accept or settings function - would give the assistant a way to change records, and
   * this test fails. Add a function here only after checking that it does not write.
   */
  const ALLOWED_IMPORTS = new Map<string, string[]>([
    ["@/modules/advisor/service", ["getRecommendation"]],
    ["@/modules/crm/communications", ["listCommunications"]],
    ["@/modules/crm/context", ["CrmContext"]],
    ["@/modules/crm/customers", ["getCustomer"]],
    ["@/modules/crm/followups", ["listFollowUps"]],
    ["@/modules/projects/service", ["getProject"]],
    ["@/modules/careops/tickets", ["getTicket"]],
    ["@/server/authz/permissions", ["Permission", "can"]],
    ["./rules", ["maskPii", "wrapUntrusted", "RiskClass"]],
    ["zod", ["z"]],
  ]);

  const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"([^"]+)"/g)].map(
    (m) => ({
      from: m[2]!,
      names: m[1]!
        .split(",")
        .map((n) => n.trim().replace(/^type\s+/, ""))
        .filter(Boolean),
    }),
  );

  it("imports only known read-only functions", () => {
    expect(imports.length).toBeGreaterThan(5);
    for (const { from, names } of imports) {
      const allowed = ALLOWED_IMPORTS.get(from);
      expect(allowed, `unexpected import from ${from}`).toBeDefined();
      for (const name of names) expect(allowed, `${from} → ${name}`).toContain(name);
    }
  });

  it("never touches the database, the quotation arithmetic or pricing directly", () => {
    for (const forbidden of [
      "getDb",
      "prisma",
      "$transaction",
      "calculateQuote",
      "@/modules/quotes",
      "@/modules/settings",
      "@/modules/users",
      "updateMany",
      ".create(",
      ".update(",
      ".delete(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("only reads and drafts: no tool is sensitive, and every tool names its permissions", () => {
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(5);
    for (const tool of AI_TOOLS) {
      expect(["read", "draft"], tool.id).toContain(tool.risk);
      expect(tool.permissions.length, tool.id).toBeGreaterThan(0);
      for (const permission of tool.permissions) expect(PERMISSIONS, tool.id).toContain(permission);
    }
  });

  it("tool ids are unique and findable", () => {
    expect(new Set(AI_TOOL_IDS).size).toBe(AI_TOOL_IDS.length);
    for (const id of AI_TOOL_IDS) expect(findTool(id)?.id).toBe(id);
    expect(findTool("approve_quote")).toBeUndefined();
    expect(findTool("set_price")).toBeUndefined();
  });

  it("drafts need the permission to write the thing they draft", () => {
    expect(findTool("draft_followup_message")!.permissions).toContain("crm:write");
    expect(findTool("draft_handover_notes")!.permissions).toContain("project:manage");
  });
});

describe("the answer shape", () => {
  it("keeps only text, points and subject - extra fields are dropped", () => {
    const parsed = aiOutput.parse({
      text: "  Résumé  ",
      points: ["a", "b"],
      subject: "Suivi",
      approveQuote: true,
      total: "999999",
      role: "owner",
    });
    expect(parsed).toEqual({ text: "Résumé", points: ["a", "b"], subject: "Suivi" });
    expect(parsed).not.toHaveProperty("approveQuote");
    expect(parsed).not.toHaveProperty("total");
  });

  it("rejects empty or oversized answers", () => {
    expect(aiOutput.safeParse({ text: "" }).success).toBe(false);
    expect(aiOutput.safeParse({ text: "x".repeat(4001) }).success).toBe(false);
    expect(aiOutput.safeParse({ text: "ok", points: Array(9).fill("p") }).success).toBe(false);
    expect(aiOutput.safeParse({ points: ["no text"] }).success).toBe(false);
    expect(aiOutput.parse({ text: "ok" }).points).toEqual([]);
  });
});
