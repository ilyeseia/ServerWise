import type { Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_FRESHNESS,
  STRICT_USAGE,
  isUsable,
  offerState,
  type OfferState,
  type UsageOptions,
} from "@/modules/catalog/freshness";
import { notFound, type CrmContext } from "@/modules/crm/context";
import { isClosed } from "@/modules/crm/lead-status";
import type { Answers } from "@/modules/questionnaire/types";
import { auditData } from "@/server/audit/tx";
import { assertCan, RuleViolationError } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";
import { deriveNeeds } from "./needs";
import { ENGINE_VERSION, runAdvisor } from "./scoring";
import type { AdvisorOutput, Candidate, OfferInfo, ProductSpecs } from "./types";

/** What was stored next to the results: enough to understand (and reproduce) the run. */
export interface StoredInputs {
  options: UsageOptions;
  freshness: { freshDays: number; expiryDays: number };
  requirementsStatus: "draft" | "complete";
  answers: Answers;
  leadBudget: { budgetMinDzd: number | null; budgetMaxDzd: number | null };
  generatedAt: string;
}

export interface RecommendationView {
  id: string;
  leadId: string;
  createdAt: Date;
  createdByName: string | null;
  engineVersion: number;
  requirementsVersion: number;
  inputs: StoredInputs;
  output: AdvisorOutput;
}

export interface RecommendationSummary {
  id: string;
  createdAt: Date;
  createdByName: string | null;
  rankedCount: number;
  excludedCount: number;
  top: { brand: string; model: string; adjusted: number; priceDzd: number | null } | null;
  options: UsageOptions;
}

const toNumber = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));

type ProductWithOffers = Prisma.ProductGetPayload<{
  include: { offers: { include: { supplier: { select: { name: true } } } } };
}>;

function toSpecs(p: ProductWithOffers): ProductSpecs {
  return {
    id: p.id,
    category: p.category,
    brand: p.brand,
    model: p.model,
    cpuBenchmark: p.cpuBenchmark,
    cpuModel: p.cpuModel,
    ramGb: p.ramGb,
    ramMaxGb: p.ramMaxGb,
    storageSlots: p.storageSlots,
    storageMaxTb: toNumber(p.storageMaxTb),
    lanSpeedMbps: p.lanSpeedMbps,
    hasWifi: p.hasWifi,
    gpuClass: p.gpuClass,
    noiseClass: p.noiseClass,
    idleWatts: p.idleWatts,
    maxWatts: p.maxWatts,
  };
}

/**
 * Chooses the price behind a recommendation. For every supplier only its newest USABLE
 * observation counts (an older price is superseded by a newer one); among suppliers the
 * cheapest wins, ties going to the more recently checked price.
 */
export function buildCandidate(p: ProductWithOffers, options: UsageOptions, now: Date): Candidate {
  const states = p.offers.map((o) => ({ offer: o, state: offerState(o, now, DEFAULT_FRESHNESS) }));

  const newestUsable = new Map<string, (typeof states)[number]>();
  for (const s of states) {
    if (!isUsable(s.state, options)) continue;
    const current = newestUsable.get(s.offer.supplierId);
    if (!current || s.offer.checkedAt > current.offer.checkedAt)
      newestUsable.set(s.offer.supplierId, s);
  }
  const best = [...newestUsable.values()].sort(
    (a, b) =>
      Number(a.offer.priceDzd) - Number(b.offer.priceDzd) ||
      b.offer.checkedAt.getTime() - a.offer.checkedAt.getTime(),
  )[0];

  const offer: OfferInfo | null = best
    ? {
        id: best.offer.id,
        supplierId: best.offer.supplierId,
        supplierName: best.offer.supplier.name,
        priceDzd: Number(best.offer.priceDzd.toString()),
        condition: best.offer.condition,
        warrantyMonths: best.offer.warrantyMonths,
        availability: best.offer.availability,
        checkedAt: best.offer.checkedAt.toISOString(),
        state: best.state,
        sourceUrl: best.offer.sourceUrl,
        quoteReference: best.offer.quoteReference,
      }
    : null;

  // For the explanation: each supplier's latest observation, if it could not be used.
  const latest = new Map<string, (typeof states)[number]>();
  for (const s of states) {
    const current = latest.get(s.offer.supplierId);
    if (!current || s.offer.checkedAt > current.offer.checkedAt) latest.set(s.offer.supplierId, s);
  }
  const unusableOffers: { id: string; state: OfferState }[] = [...latest.values()]
    .filter((s) => !isUsable(s.state, options))
    .map((s) => ({ id: s.offer.id, state: s.state }));

  return { product: toSpecs(p), offer, unusableOffers };
}

function fromRow(
  row: {
    id: string;
    leadId: string;
    engineVersion: number;
    requirementsVersion: number;
    inputs: unknown;
    results: unknown;
    createdAt: Date;
    createdById: string | null;
  },
  createdByName: string | null,
): RecommendationView {
  return {
    id: row.id,
    leadId: row.leadId,
    createdAt: row.createdAt,
    createdByName,
    engineVersion: row.engineVersion,
    requirementsVersion: row.requirementsVersion,
    inputs: row.inputs as StoredInputs,
    output: row.results as AdvisorOutput,
  };
}

/**
 * Runs the advisor for a lead and saves the result as an immutable snapshot. Needs both the
 * right to work on leads and to read the catalog. By default only fresh, verified prices are
 * used; stale and unverified ones must be asked for explicitly.
 */
export async function runAdvisorForLead(
  ctx: CrmContext,
  leadId: string,
  options: UsageOptions = STRICT_USAGE,
  now = new Date(),
): Promise<RecommendationView> {
  assertCan(ctx.actor, "crm:write");
  assertCan(ctx.actor, "catalog:read");
  const actor = ctx.actor;
  const db = getDb();

  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { requirements: true } });
  if (!lead) throw notFound("Lead");
  if (isClosed(lead.status))
    throw new RuleViolationError("LEAD_CLOSED", "A closed lead cannot be advised on");
  if (!lead.requirements) {
    throw new RuleViolationError(
      "REQUIREMENTS_MISSING",
      "Record the customer's requirements first",
    );
  }

  const products = await db.product.findMany({
    where: { active: true },
    include: { offers: { include: { supplier: { select: { name: true } } } } },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  const answers = lead.requirements.answers as Answers;
  const leadBudget = {
    budgetMinDzd: toNumber(lead.budgetMinDzd),
    budgetMaxDzd: toNumber(lead.budgetMaxDzd),
  };
  const needs = deriveNeeds(answers, leadBudget);
  const output = runAdvisor(
    needs,
    products.map((p) => buildCandidate(p, options, now)),
  );

  const inputs: StoredInputs = {
    options,
    freshness: DEFAULT_FRESHNESS,
    requirementsStatus: lead.requirements.status,
    answers,
    leadBudget,
    generatedAt: now.toISOString(),
  };

  const saved = await db.$transaction(async (tx) => {
    const row = await tx.recommendation.create({
      data: {
        leadId,
        engineVersion: ENGINE_VERSION,
        requirementsVersion: lead.requirements!.version,
        inputs: inputs as unknown as Prisma.InputJsonValue,
        results: output as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: auditData(
        actor,
        "recommendation.created",
        "recommendation",
        row.id,
        { leadId, ranked: output.ranked.length, excluded: output.excluded.length },
        ctx.client,
      ),
    });
    return row;
  });

  return fromRow(saved, actor.name);
}

async function authorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map();
  const users = await getDb().user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function listRecommendations(
  ctx: CrmContext,
  leadId: string,
): Promise<RecommendationSummary[]> {
  assertCan(ctx.actor, "crm:read");
  assertCan(ctx.actor, "catalog:read");
  const rows = await getDb().recommendation.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const names = await authorNames(rows.map((r) => r.createdById));
  return rows.map((r) => {
    const output = r.results as unknown as AdvisorOutput;
    const top = output.ranked[0];
    return {
      id: r.id,
      createdAt: r.createdAt,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      rankedCount: output.ranked.length,
      excludedCount: output.excluded.length,
      top: top
        ? {
            brand: top.brand,
            model: top.model,
            adjusted: top.adjusted,
            priceDzd: top.offer?.priceDzd ?? null,
          }
        : null,
      options: (r.inputs as unknown as StoredInputs).options,
    };
  });
}

export async function getRecommendation(ctx: CrmContext, id: string): Promise<RecommendationView> {
  assertCan(ctx.actor, "crm:read");
  assertCan(ctx.actor, "catalog:read");
  const row = await getDb().recommendation.findUnique({ where: { id } });
  if (!row) throw notFound("Recommendation");
  const names = await authorNames([row.createdById]);
  return fromRow(row, row.createdById ? (names.get(row.createdById) ?? null) : null);
}
