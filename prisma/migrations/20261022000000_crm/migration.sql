-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('individual', 'business');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('prospect', 'active', 'archived');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ar', 'fr');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('referral', 'phone', 'whatsapp', 'facebook', 'ouedkniss', 'walk_in', 'website', 'other');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('open', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('call', 'whatsapp', 'sms', 'email', 'visit', 'other');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "RequirementsStatus" AS ENUM ('draft', 'complete');

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legalName" VARCHAR(200),
    "taxId" VARCHAR(40),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "wilayaCode" INTEGER,
    "address" VARCHAR(300),
    "preferredLanguage" "Language" NOT NULL DEFAULT 'ar',
    "status" "CustomerStatus" NOT NULL DEFAULT 'prospect',
    "notes" VARCHAR(2000),
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "jobTitle" VARCHAR(120),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'other',
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "budgetMinDzd" DECIMAL(14,2),
    "budgetMaxDzd" DECIMAL(14,2),
    "ownerId" TEXT,
    "notes" VARCHAR(2000),
    "lostReason" VARCHAR(300),
    "closedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "notes" VARCHAR(1000),
    "completedAt" TIMESTAMPTZ(3),
    "completedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements_response" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "RequirementsStatus" NOT NULL DEFAULT 'draft',
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirements_response_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_name_idx" ON "customer"("name");

-- CreateIndex
CREATE INDEX "customer_phone_idx" ON "customer"("phone");

-- CreateIndex
CREATE INDEX "customer_status_idx" ON "customer"("status");

-- CreateIndex
CREATE INDEX "customer_createdAt_idx" ON "customer"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_customerId_idx" ON "contact"("customerId");

-- CreateIndex
CREATE INDEX "lead_customerId_idx" ON "lead"("customerId");

-- CreateIndex
CREATE INDEX "lead_status_idx" ON "lead"("status");

-- CreateIndex
CREATE INDEX "lead_ownerId_idx" ON "lead"("ownerId");

-- CreateIndex
CREATE INDEX "lead_createdAt_idx" ON "lead"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "follow_up_status_dueAt_idx" ON "follow_up"("status", "dueAt");

-- CreateIndex
CREATE INDEX "follow_up_assignedToId_status_idx" ON "follow_up"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "follow_up_customerId_idx" ON "follow_up"("customerId");

-- CreateIndex
CREATE INDEX "follow_up_leadId_idx" ON "follow_up"("leadId");

-- CreateIndex
CREATE INDEX "communication_customerId_occurredAt_idx" ON "communication"("customerId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "communication_leadId_idx" ON "communication"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_response_leadId_key" ON "requirements_response"("leadId");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements_response" ADD CONSTRAINT "requirements_response_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Data-integrity rules enforced by the database itself (Prisma's schema DSL cannot express them)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "customer"
  ADD CONSTRAINT "customer_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "customer_wilaya_range" CHECK ("wilayaCode" IS NULL OR "wilayaCode" BETWEEN 1 AND 58),
  ADD CONSTRAINT "customer_archive_consistent" CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL));

-- At most one primary contact per customer.
CREATE UNIQUE INDEX "contact_one_primary_per_customer" ON "contact"("customerId") WHERE "isPrimary";

ALTER TABLE "lead"
  ADD CONSTRAINT "lead_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "lead_budget_non_negative" CHECK (
    ("budgetMinDzd" IS NULL OR "budgetMinDzd" >= 0) AND ("budgetMaxDzd" IS NULL OR "budgetMaxDzd" >= 0)
  ),
  ADD CONSTRAINT "lead_budget_range" CHECK (
    "budgetMinDzd" IS NULL OR "budgetMaxDzd" IS NULL OR "budgetMaxDzd" >= "budgetMinDzd"
  ),
  ADD CONSTRAINT "lead_lost_needs_reason" CHECK ("status" <> 'lost' OR "lostReason" IS NOT NULL),
  ADD CONSTRAINT "lead_closed_consistent" CHECK (("status" IN ('won', 'lost')) = ("closedAt" IS NOT NULL));

ALTER TABLE "follow_up"
  ADD CONSTRAINT "follow_up_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "follow_up_completed_consistent" CHECK (("status" = 'done') = ("completedAt" IS NOT NULL));

-- The communication log is append-only, like the audit log.
CREATE OR REPLACE FUNCTION communication_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'communication log is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER communication_no_update_delete
BEFORE UPDATE OR DELETE ON "communication"
FOR EACH ROW EXECUTE FUNCTION communication_immutable();