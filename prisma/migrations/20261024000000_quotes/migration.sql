-- CreateEnum
CREATE TYPE "QuoteRevisionStatus" AS ENUM ('draft', 'issued', 'accepted', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "QuoteLineKind" AS ENUM ('hardware', 'labor', 'service', 'other');

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_counter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "quote_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "quote_revision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "QuoteRevisionStatus" NOT NULL DEFAULT 'draft',
    "notes" VARCHAR(2000),
    "validUntil" TIMESTAMPTZ(3),
    "issuedAt" TIMESTAMPTZ(3),
    "issuedById" TEXT,
    "subtotalDzd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountDzd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxDzd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDzd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decisionNote" VARCHAR(500),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuoteLineKind" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2),
    "productId" TEXT,
    "offerId" TEXT,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_number_key" ON "quote"("number");

-- CreateIndex
CREATE INDEX "quote_leadId_idx" ON "quote"("leadId");

-- CreateIndex
CREATE INDEX "quote_createdAt_idx" ON "quote"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "quote_revision_status_idx" ON "quote_revision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_revision_quoteId_number_key" ON "quote_revision"("quoteId", "number");

-- CreateIndex
CREATE INDEX "quote_line_productId_idx" ON "quote_line"("productId");

-- CreateIndex
CREATE INDEX "quote_line_offerId_idx" ON "quote_line"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_revisionId_position_key" ON "quote_line"("revisionId", "position");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_revision" ADD CONSTRAINT "quote_revision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "quote_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules enforced by the database as well as by the application.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_position_positive" CHECK ("position" >= 1),
  ADD CONSTRAINT "quote_line_description_not_blank" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "quote_line_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quote_line_unit_price_non_negative" CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "quote_line_discount_range" CHECK ("discountPct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quote_line_tax_range" CHECK ("taxRatePct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quote_line_cost_non_negative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

ALTER TABLE "quote_revision"
  ADD CONSTRAINT "quote_revision_number_positive" CHECK ("number" >= 1),
  ADD CONSTRAINT "quote_revision_totals_non_negative"
    CHECK ("subtotalDzd" >= 0 AND "discountDzd" >= 0 AND "taxDzd" >= 0 AND "totalDzd" >= 0),
  ADD CONSTRAINT "quote_revision_total_adds_up" CHECK ("totalDzd" = "subtotalDzd" + "taxDzd"),
  -- Anything but a draft was issued: it carries its issue data and its frozen snapshot.
  ADD CONSTRAINT "quote_revision_issued_data"
    CHECK ("status" = 'draft' OR ("issuedAt" IS NOT NULL AND "validUntil" IS NOT NULL AND "snapshot" IS NOT NULL)),
  ADD CONSTRAINT "quote_revision_decision_data"
    CHECK (("status" IN ('accepted', 'rejected')) = ("decidedAt" IS NOT NULL));

-- At most one working draft, and at most one accepted revision, per quote.
CREATE UNIQUE INDEX "quote_revision_one_draft" ON "quote_revision" ("quoteId") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "quote_revision_one_accepted" ON "quote_revision" ("quoteId") WHERE "status" = 'accepted';

-- Lines can only be changed while their revision is a draft.
CREATE OR REPLACE FUNCTION quote_line_guard() RETURNS trigger AS $$
DECLARE
  target text;
  current_status "QuoteRevisionStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    target := NEW."revisionId";
  ELSE
    target := OLD."revisionId";
  END IF;
  SELECT "status" INTO current_status FROM "quote_revision" WHERE "id" = target;
  IF current_status IS NOT NULL AND current_status <> 'draft' THEN
    RAISE EXCEPTION 'quote lines of an issued revision are immutable (create a new revision)';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."revisionId" IS DISTINCT FROM OLD."revisionId" THEN
    RAISE EXCEPTION 'a quote line cannot move to another revision';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_line_guard
BEFORE INSERT OR UPDATE OR DELETE ON "quote_line"
FOR EACH ROW EXECUTE FUNCTION quote_line_guard();

-- An issued revision is a frozen snapshot: only its status may move, along allowed paths.
CREATE OR REPLACE FUNCTION quote_revision_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'an issued quote revision cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."quoteId" IS DISTINCT FROM OLD."quoteId"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'quote revision identity is immutable';
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'issued') THEN
      RAISE EXCEPTION 'a draft can only be issued';
    END IF;
    RETURN NEW;
  END IF;

  -- From here on the revision was issued: its content never changes.
  IF NEW."notes" IS DISTINCT FROM OLD."notes"
     OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
     OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById"
     OR NEW."subtotalDzd" IS DISTINCT FROM OLD."subtotalDzd"
     OR NEW."discountDzd" IS DISTINCT FROM OLD."discountDzd"
     OR NEW."taxDzd" IS DISTINCT FROM OLD."taxDzd"
     OR NEW."totalDzd" IS DISTINCT FROM OLD."totalDzd"
     OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" THEN
    RAISE EXCEPTION 'an issued quote revision is an immutable snapshot (create a new revision)';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'issued' AND NEW."status" IN ('accepted', 'rejected', 'superseded') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid quote revision status change % -> %', OLD."status", NEW."status";
  END IF;

  IF NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
     OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById"
     OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote" THEN
    RAISE EXCEPTION 'a quote decision is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_revision_guard
BEFORE UPDATE OR DELETE ON "quote_revision"
FOR EACH ROW EXECUTE FUNCTION quote_revision_guard();

-- A quote keeps its number and lead for life.
CREATE OR REPLACE FUNCTION quote_identity_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS DISTINCT FROM OLD."number" OR NEW."leadId" IS DISTINCT FROM OLD."leadId" THEN
    RAISE EXCEPTION 'quote number and lead are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_identity_guard
BEFORE UPDATE ON "quote"
FOR EACH ROW EXECUTE FUNCTION quote_identity_guard();
