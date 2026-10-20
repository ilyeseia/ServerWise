import type { Prisma } from "@/generated/prisma/client";
import { notFound, type CrmContext } from "@/modules/crm/context";
import { isClosed } from "@/modules/crm/lead-status";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { getDefinition, LATEST_VERSION } from "./definition";
import { validateAnswers } from "./engine";
import type { Answers, QuestionnaireDefinition, ValidationCode } from "./types";

export interface RequirementsView {
  /** The definition the stored answers were given against. */
  definition: QuestionnaireDefinition;
  answers: Answers;
  status: "draft" | "complete";
  /** False when nothing has been saved yet (the form starts empty on the latest version). */
  saved: boolean;
  updatedAt: Date | null;
}

export type SaveResult =
  | { ok: true; status: "draft" | "complete"; answers: Answers }
  | { ok: false; errors: Record<string, ValidationCode> };

export async function getRequirements(ctx: CrmContext, leadId: string): Promise<RequirementsView> {
  assertCan(ctx.actor, "crm:read");
  const db = getDb();
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw notFound("Lead");

  const row = await db.requirementsResponse.findUnique({ where: { leadId } });
  if (!row) {
    return {
      definition: getDefinition(LATEST_VERSION)!,
      answers: {},
      status: "draft",
      saved: false,
      updatedAt: null,
    };
  }
  const definition = getDefinition(row.version);
  if (!definition) {
    // A stored version this build no longer knows: refuse rather than guess at its meaning.
    throw new RuleViolationError(
      "UNKNOWN_QUESTIONNAIRE_VERSION",
      `Unknown questionnaire version ${row.version}`,
    );
  }
  return {
    definition,
    answers: row.answers as Answers,
    status: row.status,
    saved: true,
    updatedAt: row.updatedAt,
  };
}

/**
 * Saves answers as a draft, or as complete when every required visible question is answered.
 * A response stays pinned to the version it was started on. Closed leads are read-only.
 */
export async function saveRequirements(
  ctx: CrmContext,
  leadId: string,
  input: Answers,
  options: { complete: boolean },
): Promise<SaveResult> {
  assertCan(ctx.actor, "crm:write");
  const actor = ctx.actor;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound("Lead");
    if (isClosed(lead.status)) {
      throw new RuleViolationError("LEAD_CLOSED", "A closed lead's requirements are read-only");
    }

    const existing = await tx.requirementsResponse.findUnique({ where: { leadId } });
    const version = existing?.version ?? LATEST_VERSION;
    const definition = getDefinition(version);
    if (!definition) {
      throw new RuleViolationError(
        "UNKNOWN_QUESTIONNAIRE_VERSION",
        `Unknown questionnaire version ${version}`,
      );
    }

    const result = validateAnswers(definition, input, { complete: options.complete });
    if (!result.ok) return { ok: false as const, errors: result.errors };

    const status = options.complete ? ("complete" as const) : ("draft" as const);
    const answers = result.answers as Prisma.InputJsonObject;
    await tx.requirementsResponse.upsert({
      where: { leadId },
      create: { leadId, version, answers, status, updatedById: actor.id },
      update: { answers, status, updatedById: actor.id },
    });
    await tx.auditLog.create({
      data: auditData(actor, "requirements.saved", "lead", leadId, { version, status }, ctx.client),
    });
    return { ok: true as const, status, answers: result.answers };
  });
}
