import { z } from "zod";
import { getRecommendation } from "@/modules/advisor/service";
import { listCommunications } from "@/modules/crm/communications";
import type { CrmContext } from "@/modules/crm/context";
import { getCustomer } from "@/modules/crm/customers";
import { listFollowUps } from "@/modules/crm/followups";
import { getProject } from "@/modules/projects/service";
import { getTicket } from "@/modules/careops/tickets";
import { can, type Permission } from "@/server/authz/permissions";
import { maskPii, wrapUntrusted, type RiskClass } from "./rules";

/**
 * The assistant's tools. A tool can only READ data - always through the normal services, as the
 * signed-in user, so every permission check of the application applies - and ask the model to write
 * text about it. No tool can change a record, set a price, change a role or approve anything: there
 * is no write capability to give it. (tests/unit/ai-tools.test.ts enforces this on the imports.)
 */

export const LANGUAGES = ["ar", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

const language = z.enum(LANGUAGES);

/** One shape for every answer: the UI shows `text`, optional `subject`, and a list of points. */
export const aiOutput = z.object({
  text: z.string().trim().min(1).max(4000),
  points: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
  subject: z.string().trim().min(1).max(200).optional(),
});
export type AiOutput = z.infer<typeof aiOutput>;

export interface Prepared {
  /** What the person wants, in plain words. */
  task: string;
  /** The data to work from, already wrapped as untrusted. */
  data: string;
  /** Which records the answer is based on (shown to the user). */
  sources: string[];
}

export interface AiTool<I = unknown> {
  id: string;
  risk: RiskClass;
  /** Permissions the user must hold, on top of `ai:use`. */
  permissions: readonly Permission[];
  input: z.ZodType<I>;
  prepare(ctx: CrmContext, input: I): Promise<Prepared>;
}

const clip = (text: string | null | undefined, max = 600) =>
  maskPii((text ?? "").trim()).slice(0, max);
const day = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------

const explainRecommendation: AiTool<{ recommendationId: string; language: Language }> = {
  id: "explain_recommendation",
  risk: "read",
  permissions: ["crm:read", "catalog:read"],
  input: z.object({ recommendationId: z.uuid(), language }),
  async prepare(ctx, input) {
    const view = await getRecommendation(ctx, input.recommendationId);
    const compact = {
      engineVersion: view.output.engineVersion,
      needs: view.output.needs,
      ranked: view.output.ranked.slice(0, 3).map((p) => ({
        product: `${p.brand} ${p.model}`,
        category: p.category,
        score: p.score,
        confidence: p.confidence,
        adjusted: p.adjusted,
        priceDzd: p.offer?.priceDzd ?? null,
        priceState: p.offer?.state ?? null,
        factors: p.factors.map((f) => ({
          id: f.id,
          weight: f.weight,
          status: f.status,
          score: f.score,
          evidence: f.evidence,
        })),
      })),
      excluded: view.output.excluded.slice(0, 5).map((p) => ({
        product: `${p.brand} ${p.model}`,
        reasons: p.exclusions,
      })),
    };
    return {
      task:
        "Explain to the salesperson, in plain language, why the first product ranks first, its weak " +
        "points, and why the excluded products were excluded. These scores were computed by the " +
        "application: explain them, never recompute, adjust or re-rank them. Put the explanation in " +
        '"text" and the weak points in "points".',
      data: wrapUntrusted("recommendation", JSON.stringify(compact), 9000),
      sources: [`recommendation:${view.id}`],
    };
  },
};

const summarizeCustomer: AiTool<{ customerId: string; language: Language }> = {
  id: "summarize_customer",
  risk: "read",
  permissions: ["crm:read"],
  input: z.object({ customerId: z.uuid(), language }),
  async prepare(ctx, input) {
    const [customer, communications, followUps] = await Promise.all([
      getCustomer(ctx, input.customerId),
      listCommunications(ctx, { customerId: input.customerId }, 15),
      listFollowUps(ctx, { customerId: input.customerId, status: "open", pageSize: 10 }),
    ]);
    const lines = [
      `Customer: ${customer.name} (${customer.type}, status ${customer.status})`,
      ...customer.leads.slice(0, 5).map((l) => `Lead: ${clip(l.title, 120)} [${l.status}]`),
      ...communications.map(
        (c) => `${day(c.occurredAt)} ${c.channel} ${c.direction}: ${clip(c.summary)}`,
      ),
      ...followUps.items.map((f) => `Open follow-up due ${day(f.dueAt)}: ${clip(f.title, 160)}`),
    ];
    return {
      task:
        'Summarise the relationship with this customer in "text", and list the most useful next ' +
        'steps in "points". Do not invent facts that are not in the data.',
      data: wrapUntrusted("customer_history", lines.join("\n"), 7000),
      sources: [
        `customer:${customer.id}`,
        ...communications.slice(0, 15).map((c) => `communication:${c.id}`),
      ],
    };
  },
};

const summarizeTicket: AiTool<{ ticketId: string; language: Language }> = {
  id: "summarize_ticket",
  risk: "read",
  permissions: ["ticket:read"],
  input: z.object({ ticketId: z.uuid(), language }),
  async prepare(ctx, input) {
    const ticket = await getTicket(ctx, input.ticketId);
    const lines = [
      `Ticket ${ticket.number}: ${clip(ticket.title, 200)} [${ticket.status}, ${ticket.priority}]`,
      `Description: ${clip(ticket.description, 1500)}`,
      ...ticket.comments.map((c) => `${day(c.createdAt)} comment: ${clip(c.body)}`),
      ticket.resolution ? `Resolution: ${clip(ticket.resolution, 800)}` : "No resolution yet.",
    ];
    return {
      task:
        'Summarise this support ticket in "text" and list the open questions that still need an ' +
        'answer in "points".',
      data: wrapUntrusted("ticket", lines.join("\n"), 7000),
      sources: [`ticket:${ticket.id}`],
    };
  },
};

const draftFollowUp: AiTool<{ customerId: string; goal: string; language: Language }> = {
  id: "draft_followup_message",
  risk: "draft",
  permissions: ["crm:write"],
  input: z.object({
    customerId: z.uuid(),
    goal: z.string().trim().min(3).max(500),
    language,
  }),
  async prepare(ctx, input) {
    const [customer, communications] = await Promise.all([
      getCustomer(ctx, input.customerId),
      listCommunications(ctx, { customerId: input.customerId }, 5),
    ]);
    const lines = [
      `Customer: ${customer.name} (prefers ${customer.preferredLanguage})`,
      ...communications.map(
        (c) => `${day(c.occurredAt)} ${c.channel} ${c.direction}: ${clip(c.summary, 300)}`,
      ),
    ];
    return {
      task:
        `Write a short, polite follow-up message to the customer. The salesperson's goal: "${input.goal}". ` +
        'Put the message body in "text" and a short subject in "subject". Do not promise prices, ' +
        "dates or discounts. It is a draft that a person will read and send; you send nothing.",
      data: wrapUntrusted("customer_history", lines.join("\n"), 4000),
      sources: [`customer:${customer.id}`],
    };
  },
};

const draftHandoverNotes: AiTool<{ projectId: string; language: Language }> = {
  id: "draft_handover_notes",
  risk: "draft",
  permissions: ["project:manage"],
  input: z.object({ projectId: z.uuid(), language }),
  async prepare(ctx, input) {
    const project = await getProject(ctx, input.projectId);
    const lines = [
      `Project ${project.number}: ${clip(project.title, 200)} [${project.status}]`,
      `Rollback plan: ${clip(project.rollbackPlan, 1200)}`,
      ...project.tasks.map((t) => {
        const done = t.checklist.filter((i) => i.done).length;
        return `Task [${t.status}] ${clip(t.title, 200)} (checklist ${done}/${t.checklist.length})`;
      }),
      ...project.milestones.map(
        (m) => `Milestone ${clip(m.title, 120)}${m.doneAt ? " (done)" : ""}`,
      ),
    ];
    return {
      task:
        'Draft the handover notes for the customer in "text": what was delivered, what was ' +
        "tested, and what the customer should know. NEVER write passwords, keys or VPN details: " +
        "say that access details are handed over through a secure channel and name where they are kept " +
        "only if the data says so.",
      data: wrapUntrusted("project", lines.join("\n"), 8000),
      sources: [`project:${project.id}`],
    };
  },
};

// ---------------------------------------------------------------------------------------------

export const AI_TOOLS: readonly AiTool<never>[] = [
  explainRecommendation,
  summarizeCustomer,
  summarizeTicket,
  draftFollowUp,
  draftHandoverNotes,
] as unknown as readonly AiTool<never>[];

export const AI_TOOL_IDS = AI_TOOLS.map((tool) => tool.id);

/** Whether a role may use a tool: `ai:use` and every permission the tool reads with. */
export function canRunTool(role: unknown, id: string): boolean {
  const tool = findTool(id);
  return Boolean(tool) && can(role, "ai:use") && tool!.permissions.every((p) => can(role, p));
}

export function findTool(id: string): AiTool<unknown> | undefined {
  return (AI_TOOLS as readonly AiTool<unknown>[]).find((tool) => tool.id === id);
}
