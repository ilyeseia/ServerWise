-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('ok', 'unavailable', 'invalid', 'limited', 'error');

-- CreateTable
CREATE TABLE "ai_request" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tool" VARCHAR(60) NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "provider" VARCHAR(40),
    "model" VARCHAR(80),
    "inputChars" INTEGER NOT NULL DEFAULT 0,
    "outputChars" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_request_userId_createdAt_idx" ON "ai_request"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_request_createdAt_idx" ON "ai_request"("createdAt" DESC);


-- ---------------------------------------------------------------------------------------------
-- The AI log is a record: sizes are sane and rows are append-only.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "ai_request"
  ADD CONSTRAINT "ai_request_sizes_non_negative"
    CHECK ("inputChars" >= 0 AND "outputChars" >= 0 AND "latencyMs" >= 0),
  ADD CONSTRAINT "ai_request_tool_not_blank" CHECK (length(btrim("tool")) > 0);

CREATE OR REPLACE FUNCTION ai_request_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_request is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_request_no_update_delete
BEFORE UPDATE OR DELETE ON "ai_request"
FOR EACH ROW EXECUTE FUNCTION ai_request_append_only();
