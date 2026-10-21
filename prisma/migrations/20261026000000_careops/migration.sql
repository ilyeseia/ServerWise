-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('server', 'nas', 'workstation', 'network_device', 'ups', 'software_service', 'subscription', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'faulty', 'retired');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateTable
CREATE TABLE "ticket_counter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "ticket_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "productId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "brand" VARCHAR(80),
    "model" VARCHAR(120),
    "serialNumber" VARCHAR(120),
    "os" VARCHAR(120),
    "version" VARCHAR(60),
    "location" VARCHAR(200),
    "installedAt" TIMESTAMPTZ(3),
    "warrantyUntil" TIMESTAMPTZ(3),
    "renewsAt" TIMESTAMPTZ(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "credentialsRef" VARCHAR(300),
    "notes" VARCHAR(1000),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_contract" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "monthlyFeeDzd" DECIMAL(14,2),
    "notes" VARCHAR(1000),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(300),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_asset" (
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "contract_asset_pkey" PRIMARY KEY ("contractId","assetId")
);

-- CreateTable
CREATE TABLE "maintenance_schedule" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "anchorDate" TIMESTAMPTZ(3) NOT NULL,
    "lastDoneAt" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_reminder" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dueDate" TIMESTAMPTZ(3) NOT NULL,
    "followUpId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "ticketId" TEXT,
    "assetId" TEXT,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "performedById" TEXT,
    "summary" VARCHAR(2000) NOT NULL,
    "partsReplaced" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "customerId" TEXT NOT NULL,
    "assetId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(4000),
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "assigneeId" TEXT,
    "resolution" VARCHAR(2000),
    "resolvedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_customerId_idx" ON "asset"("customerId");

-- CreateIndex
CREATE INDEX "asset_status_idx" ON "asset"("status");

-- CreateIndex
CREATE INDEX "asset_warrantyUntil_idx" ON "asset"("warrantyUntil");

-- CreateIndex
CREATE INDEX "maintenance_contract_customerId_idx" ON "maintenance_contract"("customerId");

-- CreateIndex
CREATE INDEX "maintenance_contract_endsAt_idx" ON "maintenance_contract"("endsAt");

-- CreateIndex
CREATE INDEX "contract_asset_assetId_idx" ON "contract_asset"("assetId");

-- CreateIndex
CREATE INDEX "maintenance_schedule_contractId_idx" ON "maintenance_schedule"("contractId");

-- CreateIndex
CREATE INDEX "maintenance_schedule_active_idx" ON "maintenance_schedule"("active");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_reminder_scheduleId_dueDate_key" ON "maintenance_reminder"("scheduleId", "dueDate");

-- CreateIndex
CREATE INDEX "service_report_customerId_performedAt_idx" ON "service_report"("customerId", "performedAt" DESC);

-- CreateIndex
CREATE INDEX "service_report_scheduleId_idx" ON "service_report"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_number_key" ON "ticket"("number");

-- CreateIndex
CREATE INDEX "ticket_customerId_idx" ON "ticket"("customerId");

-- CreateIndex
CREATE INDEX "ticket_status_priority_idx" ON "ticket"("status", "priority");

-- CreateIndex
CREATE INDEX "ticket_assigneeId_status_idx" ON "ticket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ticket_comment_ticketId_createdAt_idx" ON "ticket_comment"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_contract" ADD CONSTRAINT "maintenance_contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_asset" ADD CONSTRAINT "contract_asset_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "maintenance_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_asset" ADD CONSTRAINT "contract_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedule" ADD CONSTRAINT "maintenance_schedule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "maintenance_contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedule" ADD CONSTRAINT "maintenance_schedule_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_reminder" ADD CONSTRAINT "maintenance_reminder_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "maintenance_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_reminder" ADD CONSTRAINT "maintenance_reminder_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_up"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "maintenance_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules enforced by the database as well as by the application.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "asset"
  ADD CONSTRAINT "asset_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "asset_warranty_after_install"
    CHECK ("installedAt" IS NULL OR "warrantyUntil" IS NULL OR "warrantyUntil" >= "installedAt");

-- A serial number identifies one device of a customer.
CREATE UNIQUE INDEX "asset_customer_serial" ON "asset" ("customerId", "serialNumber") WHERE "serialNumber" IS NOT NULL;

ALTER TABLE "maintenance_contract"
  ADD CONSTRAINT "contract_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "contract_dates_ordered" CHECK ("endsAt" >= "startsAt"),
  ADD CONSTRAINT "contract_fee_non_negative" CHECK ("monthlyFeeDzd" IS NULL OR "monthlyFeeDzd" >= 0),
  ADD CONSTRAINT "contract_cancel_reason"
    CHECK ("cancelledAt" IS NULL OR length(btrim(coalesce("cancelReason", ''))) > 0);

ALTER TABLE "maintenance_schedule"
  ADD CONSTRAINT "schedule_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "schedule_interval_range" CHECK ("intervalMonths" BETWEEN 1 AND 60);

ALTER TABLE "service_report"
  ADD CONSTRAINT "service_report_summary_not_blank" CHECK (length(btrim("summary")) > 0);

ALTER TABLE "ticket"
  ADD CONSTRAINT "ticket_title_not_blank" CHECK (length(btrim("title")) > 0),
  -- A resolved ticket says how it was resolved.
  ADD CONSTRAINT "ticket_resolution_when_resolved"
    CHECK ("status" <> 'resolved' OR (length(btrim(coalesce("resolution", ''))) > 0 AND "resolvedAt" IS NOT NULL)),
  -- closedAt is set exactly when the ticket is closed.
  ADD CONSTRAINT "ticket_closed_at_matches" CHECK (("status" = 'closed') = ("closedAt" IS NOT NULL));

ALTER TABLE "ticket_comment"
  ADD CONSTRAINT "ticket_comment_body_not_blank" CHECK (length(btrim("body")) > 0);

-- An asset keeps its customer for life, and its project must belong to that customer.
CREATE OR REPLACE FUNCTION asset_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
    RAISE EXCEPTION 'an asset cannot move to another customer';
  END IF;
  IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "project" p JOIN "lead" l ON l."id" = p."leadId"
    WHERE p."id" = NEW."projectId" AND l."customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'the project belongs to another customer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_guard
BEFORE INSERT OR UPDATE ON "asset"
FOR EACH ROW EXECUTE FUNCTION asset_guard();

-- A contract keeps its customer, and covers only that customer's assets.
CREATE OR REPLACE FUNCTION contract_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
    RAISE EXCEPTION 'a contract cannot move to another customer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_guard
BEFORE UPDATE ON "maintenance_contract"
FOR EACH ROW EXECUTE FUNCTION contract_guard();

CREATE OR REPLACE FUNCTION contract_asset_guard() RETURNS trigger AS $$
BEGIN
  IF (SELECT "customerId" FROM "maintenance_contract" WHERE "id" = NEW."contractId")
     IS DISTINCT FROM (SELECT "customerId" FROM "asset" WHERE "id" = NEW."assetId") THEN
    RAISE EXCEPTION 'a contract can only cover assets of its own customer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_asset_guard
BEFORE INSERT OR UPDATE ON "contract_asset"
FOR EACH ROW EXECUTE FUNCTION contract_asset_guard();

-- Service reports and ticket comments are records: append-only.
CREATE OR REPLACE FUNCTION careops_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_report_no_update_delete
BEFORE UPDATE OR DELETE ON "service_report"
FOR EACH ROW EXECUTE FUNCTION careops_append_only();

CREATE TRIGGER ticket_comment_no_update_delete
BEFORE UPDATE OR DELETE ON "ticket_comment"
FOR EACH ROW EXECUTE FUNCTION careops_append_only();

-- Nobody comments on a closed ticket.
CREATE OR REPLACE FUNCTION ticket_comment_guard() RETURNS trigger AS $$
BEGIN
  IF (SELECT "status" FROM "ticket" WHERE "id" = NEW."ticketId") = 'closed' THEN
    RAISE EXCEPTION 'a closed ticket cannot receive comments';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_comment_guard
BEFORE INSERT ON "ticket_comment"
FOR EACH ROW EXECUTE FUNCTION ticket_comment_guard();

-- Ticket identity is fixed, closed is final, and status follows the state machine.
CREATE OR REPLACE FUNCTION ticket_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tickets are history and cannot be deleted';
  END IF;

  IF NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'ticket identity is immutable';
  END IF;

  IF OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'a closed ticket is final and cannot change';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'open'             AND NEW."status" IN ('in_progress', 'waiting_customer', 'resolved', 'closed')) OR
      (OLD."status" = 'in_progress'      AND NEW."status" IN ('open', 'waiting_customer', 'resolved')) OR
      (OLD."status" = 'waiting_customer' AND NEW."status" IN ('in_progress', 'resolved', 'closed')) OR
      (OLD."status" = 'resolved'         AND NEW."status" IN ('in_progress', 'closed'))
    ) THEN
      RAISE EXCEPTION 'invalid ticket status change % -> %', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_guard
BEFORE UPDATE OR DELETE ON "ticket"
FOR EACH ROW EXECUTE FUNCTION ticket_guard();
