-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('files', 'database', 'system_image', 'configuration', 'other');

-- CreateEnum
CREATE TYPE "BackupOutcome" AS ENUM ('success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "RestoreOutcome" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "RemotePlanStatus" AS ENUM ('draft', 'approved', 'retired');

-- CreateEnum
CREATE TYPE "TailnetOwner" AS ENUM ('customer', 'provider');

-- CreateTable
CREATE TABLE "backup_policy" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assetId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "frequencyDays" INTEGER NOT NULL,
    "retentionDays" INTEGER,
    "destination" VARCHAR(300) NOT NULL,
    "encrypted" BOOLEAN,
    "encryptionKeyRef" VARCHAR(300),
    "offsite" BOOLEAN,
    "restoreTestEveryDays" INTEGER NOT NULL DEFAULT 90,
    "recoveryProcedure" VARCHAR(4000),
    "recoveryReviewedAt" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_record" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "ranAt" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "BackupOutcome" NOT NULL,
    "sizeMb" INTEGER,
    "notes" VARCHAR(1000),
    "recordedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_test" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "testedAt" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "RestoreOutcome" NOT NULL,
    "durationMinutes" INTEGER,
    "notes" VARCHAR(1000),
    "testedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remote_access_plan" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "RemotePlanStatus" NOT NULL DEFAULT 'draft',
    "tailnetOwner" "TailnetOwner" NOT NULL DEFAULT 'customer',
    "devices" VARCHAR(2000),
    "aclNotes" VARCHAR(4000),
    "deviceApproval" BOOLEAN NOT NULL DEFAULT false,
    "keyExpiry" BOOLEAN NOT NULL DEFAULT false,
    "noPublicExposure" BOOLEAN NOT NULL DEFAULT false,
    "noSubnetOrExit" BOOLEAN NOT NULL DEFAULT false,
    "mfa" BOOLEAN NOT NULL DEFAULT false,
    "exceptions" VARCHAR(2000),
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "retiredAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_access_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_policy_customerId_idx" ON "backup_policy"("customerId");

-- CreateIndex
CREATE INDEX "backup_policy_active_idx" ON "backup_policy"("active");

-- CreateIndex
CREATE INDEX "backup_record_policyId_ranAt_idx" ON "backup_record"("policyId", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "restore_test_policyId_testedAt_idx" ON "restore_test"("policyId", "testedAt" DESC);

-- CreateIndex
CREATE INDEX "remote_access_plan_customerId_idx" ON "remote_access_plan"("customerId");

-- CreateIndex
CREATE INDEX "remote_access_plan_status_idx" ON "remote_access_plan"("status");

-- AddForeignKey
ALTER TABLE "backup_policy" ADD CONSTRAINT "backup_policy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_policy" ADD CONSTRAINT "backup_policy_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_record" ADD CONSTRAINT "backup_record_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "backup_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_test" ADD CONSTRAINT "restore_test_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "backup_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_access_plan" ADD CONSTRAINT "remote_access_plan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules enforced by the database as well as by the application.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "backup_policy"
  ADD CONSTRAINT "backup_policy_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "backup_policy_destination_not_blank" CHECK (length(btrim("destination")) > 0),
  ADD CONSTRAINT "backup_policy_frequency_range" CHECK ("frequencyDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "backup_policy_retention_range" CHECK ("retentionDays" IS NULL OR "retentionDays" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "backup_policy_restore_test_range" CHECK ("restoreTestEveryDays" BETWEEN 1 AND 730);

ALTER TABLE "backup_record"
  ADD CONSTRAINT "backup_record_size_non_negative" CHECK ("sizeMb" IS NULL OR "sizeMb" >= 0);

ALTER TABLE "restore_test"
  ADD CONSTRAINT "restore_test_duration_non_negative" CHECK ("durationMinutes" IS NULL OR "durationMinutes" >= 0);

ALTER TABLE "remote_access_plan"
  ADD CONSTRAINT "remote_plan_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "remote_plan_approved_at_matches" CHECK (("status" IN ('approved')) = ("approvedAt" IS NOT NULL) OR "status" = 'retired'),
  ADD CONSTRAINT "remote_plan_retired_at_matches" CHECK (("status" = 'retired') = ("retiredAt" IS NOT NULL)),
  -- An approved plan follows the security policy, or explains in writing where it does not.
  ADD CONSTRAINT "remote_plan_gaps_explained" CHECK (
    "status" <> 'approved'
    OR ("deviceApproval" AND "keyExpiry" AND "noPublicExposure" AND "noSubnetOrExit" AND "mfa" AND "tailnetOwner" = 'customer')
    OR length(btrim(coalesce("exceptions", ''))) > 0
  );

-- A policy keeps its customer for life, and its asset must belong to that customer.
CREATE OR REPLACE FUNCTION backup_policy_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
    RAISE EXCEPTION 'a backup policy cannot move to another customer';
  END IF;
  IF NEW."assetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "asset" WHERE "id" = NEW."assetId" AND "customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'the asset belongs to another customer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER backup_policy_guard
BEFORE INSERT OR UPDATE ON "backup_policy"
FOR EACH ROW EXECUTE FUNCTION backup_policy_guard();

-- Backup runs and restore drills are records: append-only.
CREATE OR REPLACE FUNCTION backups_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER backup_record_no_update_delete
BEFORE UPDATE OR DELETE ON "backup_record"
FOR EACH ROW EXECUTE FUNCTION backups_append_only();

CREATE TRIGGER restore_test_no_update_delete
BEFORE UPDATE OR DELETE ON "restore_test"
FOR EACH ROW EXECUTE FUNCTION backups_append_only();

-- A remote access plan: identity is fixed, approved plans are frozen (retire and replace),
-- retired is final, and status only moves forward.
CREATE OR REPLACE FUNCTION remote_plan_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'remote access plans are history and cannot be deleted';
  END IF;
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'remote access plan identity is immutable';
  END IF;
  IF OLD."status" = 'retired' THEN
    RAISE EXCEPTION 'a retired plan is final and cannot change';
  END IF;
  IF OLD."status" = 'approved' THEN
    IF NEW."status" <> 'retired' THEN
      RAISE EXCEPTION 'an approved plan can only be retired (create a new plan for changes)';
    END IF;
    IF NEW."title" IS DISTINCT FROM OLD."title"
       OR NEW."tailnetOwner" IS DISTINCT FROM OLD."tailnetOwner"
       OR NEW."devices" IS DISTINCT FROM OLD."devices"
       OR NEW."aclNotes" IS DISTINCT FROM OLD."aclNotes"
       OR NEW."deviceApproval" IS DISTINCT FROM OLD."deviceApproval"
       OR NEW."keyExpiry" IS DISTINCT FROM OLD."keyExpiry"
       OR NEW."noPublicExposure" IS DISTINCT FROM OLD."noPublicExposure"
       OR NEW."noSubnetOrExit" IS DISTINCT FROM OLD."noSubnetOrExit"
       OR NEW."mfa" IS DISTINCT FROM OLD."mfa"
       OR NEW."exceptions" IS DISTINCT FROM OLD."exceptions"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById" THEN
      RAISE EXCEPTION 'an approved plan cannot change while being retired';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER remote_plan_guard
BEFORE UPDATE OR DELETE ON "remote_access_plan"
FOR EACH ROW EXECUTE FUNCTION remote_plan_guard();
