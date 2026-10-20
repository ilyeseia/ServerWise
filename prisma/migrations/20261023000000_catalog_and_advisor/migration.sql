-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('mini_pc', 'refurbished_desktop', 'nas', 'workstation', 'server');

-- CreateEnum
CREATE TYPE "GpuClass" AS ENUM ('none', 'integrated', 'dedicated');

-- CreateEnum
CREATE TYPE "NoiseClass" AS ENUM ('silent', 'quiet', 'normal', 'loud');

-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('retailer', 'marketplace_seller', 'manufacturer', 'importer', 'individual');

-- CreateEnum
CREATE TYPE "OfferCondition" AS ENUM ('new', 'refurbished', 'used');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('in_stock', 'limited', 'on_order', 'out_of_stock', 'unknown');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "brand" VARCHAR(80) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "cpuModel" VARCHAR(120),
    "cpuCores" INTEGER,
    "cpuBenchmark" INTEGER,
    "cpuBenchmarkSource" VARCHAR(300),
    "ramGb" INTEGER,
    "ramMaxGb" INTEGER,
    "storageSlots" INTEGER,
    "storageMaxTb" DECIMAL(8,2),
    "lanPorts" INTEGER,
    "lanSpeedMbps" INTEGER,
    "hasWifi" BOOLEAN,
    "gpuClass" "GpuClass",
    "noiseClass" "NoiseClass",
    "idleWatts" INTEGER,
    "maxWatts" INTEGER,
    "ecc" BOOLEAN,
    "specsSource" VARCHAR(300),
    "notes" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" "SupplierKind" NOT NULL,
    "wilayaCode" INTEGER,
    "phone" VARCHAR(30),
    "url" VARCHAR(300),
    "notes" VARCHAR(1000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_offer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "priceDzd" DECIMAL(14,2) NOT NULL,
    "condition" "OfferCondition" NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'unknown',
    "warrantyMonths" INTEGER,
    "locationWilayaCode" INTEGER,
    "sourceUrl" VARCHAR(500),
    "quoteReference" VARCHAR(160),
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedById" TEXT,
    "notes" VARCHAR(1000),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "engineVersion" INTEGER NOT NULL,
    "requirementsVersion" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_category_idx" ON "product"("category");

-- CreateIndex
CREATE INDEX "product_brand_model_idx" ON "product"("brand", "model");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_name_key" ON "supplier"("name");

-- CreateIndex
CREATE INDEX "supplier_offer_productId_checkedAt_idx" ON "supplier_offer"("productId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "supplier_offer_supplierId_idx" ON "supplier_offer"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_offer_verificationStatus_idx" ON "supplier_offer"("verificationStatus");

-- CreateIndex
CREATE INDEX "recommendation_leadId_createdAt_idx" ON "recommendation"("leadId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "supplier_offer" ADD CONSTRAINT "supplier_offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_offer" ADD CONSTRAINT "supplier_offer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Data-integrity rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "product"
  ADD CONSTRAINT "product_brand_model_not_blank" CHECK (length(btrim("brand")) > 0 AND length(btrim("model")) > 0),
  ADD CONSTRAINT "product_ram_positive" CHECK ("ramGb" IS NULL OR "ramGb" > 0),
  ADD CONSTRAINT "product_ram_max" CHECK ("ramMaxGb" IS NULL OR "ramGb" IS NULL OR "ramMaxGb" >= "ramGb"),
  ADD CONSTRAINT "product_cpu_positive" CHECK (("cpuCores" IS NULL OR "cpuCores" > 0) AND ("cpuBenchmark" IS NULL OR "cpuBenchmark" > 0)),
  ADD CONSTRAINT "product_storage_non_negative" CHECK (("storageSlots" IS NULL OR "storageSlots" >= 0) AND ("storageMaxTb" IS NULL OR "storageMaxTb" >= 0)),
  ADD CONSTRAINT "product_network_positive" CHECK (("lanPorts" IS NULL OR "lanPorts" >= 0) AND ("lanSpeedMbps" IS NULL OR "lanSpeedMbps" > 0)),
  ADD CONSTRAINT "product_power_consistent" CHECK (
    ("idleWatts" IS NULL OR "idleWatts" >= 0) AND ("maxWatts" IS NULL OR "maxWatts" > 0)
    AND ("idleWatts" IS NULL OR "maxWatts" IS NULL OR "maxWatts" >= "idleWatts")
  );

ALTER TABLE "supplier"
  ADD CONSTRAINT "supplier_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "supplier_wilaya_range" CHECK ("wilayaCode" IS NULL OR "wilayaCode" BETWEEN 1 AND 58);

ALTER TABLE "supplier_offer"
  ADD CONSTRAINT "offer_price_positive" CHECK ("priceDzd" > 0),
  ADD CONSTRAINT "offer_warranty_range" CHECK ("warrantyMonths" IS NULL OR "warrantyMonths" BETWEEN 0 AND 120),
  ADD CONSTRAINT "offer_location_range" CHECK ("locationWilayaCode" IS NULL OR "locationWilayaCode" BETWEEN 1 AND 58),
  -- Never a price without evidence: a link to the listing, or a reference for a manual quotation.
  ADD CONSTRAINT "offer_needs_evidence" CHECK (
    (length(btrim(coalesce("sourceUrl", ''))) > 0) OR (length(btrim(coalesce("quoteReference", ''))) > 0)
  ),
  -- 'verified' and 'rejected' always carry who/when; 'unverified' never does.
  ADD CONSTRAINT "offer_verification_consistent" CHECK (
    ("verificationStatus" = 'unverified') = ("verifiedAt" IS NULL)
  );

-- A price observation is history: only its verification fields and notes may change, and a
-- verification decision is final (to correct a price, record a new observation).
CREATE OR REPLACE FUNCTION supplier_offer_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier_offer rows are history and cannot be deleted';
  END IF;

  IF NEW."productId" IS DISTINCT FROM OLD."productId"
     OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
     OR NEW."priceDzd" IS DISTINCT FROM OLD."priceDzd"
     OR NEW."condition" IS DISTINCT FROM OLD."condition"
     OR NEW."availability" IS DISTINCT FROM OLD."availability"
     OR NEW."warrantyMonths" IS DISTINCT FROM OLD."warrantyMonths"
     OR NEW."locationWilayaCode" IS DISTINCT FROM OLD."locationWilayaCode"
     OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
     OR NEW."quoteReference" IS DISTINCT FROM OLD."quoteReference"
     OR NEW."checkedAt" IS DISTINCT FROM OLD."checkedAt"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'supplier_offer is immutable: record a new price observation instead';
  END IF;

  IF OLD."verificationStatus" <> 'unverified'
     AND NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus" THEN
    RAISE EXCEPTION 'supplier_offer verification decision is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_offer_guard_update
BEFORE UPDATE ON "supplier_offer"
FOR EACH ROW EXECUTE FUNCTION supplier_offer_guard();

CREATE TRIGGER supplier_offer_guard_delete
BEFORE DELETE ON "supplier_offer"
FOR EACH ROW EXECUTE FUNCTION supplier_offer_guard();

-- Saved recommendations are snapshots and never change.
CREATE OR REPLACE FUNCTION recommendation_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'recommendation is an immutable snapshot (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recommendation_no_update_delete
BEFORE UPDATE OR DELETE ON "recommendation"
FOR EACH ROW EXECUTE FUNCTION recommendation_immutable();