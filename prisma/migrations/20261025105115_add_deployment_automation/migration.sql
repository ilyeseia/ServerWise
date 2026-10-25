-- CreateEnum
CREATE TYPE "DeploymentProviderType" AS ENUM ('proxmox', 'ssh_ansible', 'docker_engine', 'docker_compose', 'nas_generic', 'custom');

-- CreateEnum
CREATE TYPE "DeploymentCredentialType" AS ENUM ('api_token', 'ssh_key', 'username_password', 'oauth_token', 'custom');

-- CreateEnum
CREATE TYPE "DeploymentJobStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'planned', 'executing', 'completed', 'failed', 'cancelled', 'rolling_back', 'rolled_back');

-- CreateEnum
CREATE TYPE "DeploymentStepStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped', 'rolled_back');

-- CreateEnum
CREATE TYPE "DeploymentStepKind" AS ENUM ('validation', 'provisioning', 'configuration', 'verification', 'rollback', 'custom');

-- CreateTable
CREATE TABLE "deployment_provider" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "DeploymentProviderType" NOT NULL,
    "endpoint" VARCHAR(500) NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_credential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "type" "DeploymentCredentialType" NOT NULL,
    "identifier" VARCHAR(100) NOT NULL,
    "secretRef" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_job" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "providerId" TEXT NOT NULL,
    "customerId" TEXT,
    "projectId" TEXT,
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(4000),
    "status" "DeploymentJobStatus" NOT NULL DEFAULT 'pending_approval',
    "plan" JSONB,
    "rollbackPlan" JSONB,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMPTZ(3),
    "rejectionReason" VARCHAR(1000),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorMessage" VARCHAR(2000),
    "idempotencyKey" VARCHAR(100),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_job_counter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "deployment_job_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "deployment_approval" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requiredBy" VARCHAR(100) NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMPTZ(3),
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_step" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "DeploymentStepKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "status" "DeploymentStepStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" VARCHAR(2000),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_log" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "message" VARCHAR(4000) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployment_provider_type_idx" ON "deployment_provider"("type");

-- CreateIndex
CREATE INDEX "deployment_provider_active_idx" ON "deployment_provider"("active");

-- CreateIndex
CREATE INDEX "deployment_provider_customerId_idx" ON "deployment_provider"("customerId");

-- CreateIndex
CREATE INDEX "deployment_credential_providerId_idx" ON "deployment_credential"("providerId");

-- CreateIndex
CREATE INDEX "deployment_credential_active_idx" ON "deployment_credential"("active");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_job_number_key" ON "deployment_job"("number");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_job_idempotencyKey_key" ON "deployment_job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "deployment_job_providerId_idx" ON "deployment_job"("providerId");

-- CreateIndex
CREATE INDEX "deployment_job_customerId_idx" ON "deployment_job"("customerId");

-- CreateIndex
CREATE INDEX "deployment_job_projectId_idx" ON "deployment_job"("projectId");

-- CreateIndex
CREATE INDEX "deployment_job_status_idx" ON "deployment_job"("status");

-- CreateIndex
CREATE INDEX "deployment_job_createdAt_idx" ON "deployment_job"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "deployment_approval_jobId_idx" ON "deployment_approval"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_approval_jobId_requiredBy_key" ON "deployment_approval"("jobId", "requiredBy");

-- CreateIndex
CREATE INDEX "deployment_step_jobId_position_idx" ON "deployment_step"("jobId", "position");

-- CreateIndex
CREATE INDEX "deployment_step_status_idx" ON "deployment_step"("status");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_step_jobId_position_key" ON "deployment_step"("jobId", "position");

-- CreateIndex
CREATE INDEX "deployment_log_stepId_createdAt_idx" ON "deployment_log"("stepId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "deployment_credential" ADD CONSTRAINT "deployment_credential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "deployment_provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_job" ADD CONSTRAINT "deployment_job_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "deployment_provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_job" ADD CONSTRAINT "deployment_job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_job" ADD CONSTRAINT "deployment_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_approval" ADD CONSTRAINT "deployment_approval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "deployment_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_step" ADD CONSTRAINT "deployment_step_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "deployment_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_log" ADD CONSTRAINT "deployment_log_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "deployment_step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
