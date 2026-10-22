-- Stage 11: the reports filter by event date. Measured on 80 000 tickets, 20 000 revisions and
-- 40 000 leads: counting a 30-day window went from a sequential scan (18-60 ms) to an index scan
-- (1-6 ms). Plain B-tree indexes, named as Prisma names them so the schema has no drift.
CREATE INDEX "ticket_createdAt_idx" ON "ticket"("createdAt");
CREATE INDEX "ticket_resolvedAt_idx" ON "ticket"("resolvedAt");
CREATE INDEX "quote_revision_issuedAt_idx" ON "quote_revision"("issuedAt");
CREATE INDEX "quote_revision_decidedAt_idx" ON "quote_revision"("decidedAt");
CREATE INDEX "lead_closedAt_idx" ON "lead"("closedAt");
