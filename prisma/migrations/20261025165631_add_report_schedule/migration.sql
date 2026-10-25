-- CreateTable
CREATE TABLE "report_schedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "nextRunAt" TIMESTAMPTZ(3),
    "lastRunAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "recipientEmails" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_schedule_userId_idx" ON "report_schedule"("userId");

-- CreateIndex
CREATE INDEX "report_schedule_cronExpression_idx" ON "report_schedule"("cronExpression");

-- AddForeignKey
ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
