-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('planned', 'in_progress', 'on_hold', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'blocked', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('survey', 'rollback', 'work', 'test', 'handover', 'custom');

-- CreateTable
CREATE TABLE "project_counter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "project_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'planned',
    "managerId" TEXT,
    "startDate" TIMESTAMPTZ(3),
    "targetDate" TIMESTAMPTZ(3),
    "rollbackPlan" VARCHAR(4000),
    "handoverNotes" VARCHAR(4000),
    "handoverAt" TIMESTAMPTZ(3),
    "handoverById" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(300),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "dueDate" TIMESTAMPTZ(3),
    "position" INTEGER NOT NULL,
    "doneAt" TIMESTAMPTZ(3),

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "kind" "TaskKind" NOT NULL DEFAULT 'custom',
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(2000),
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMPTZ(3),
    "position" INTEGER NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "task_dependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "checklist_item" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMPTZ(3),
    "doneById" TEXT,

    CONSTRAINT "checklist_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_number_key" ON "project"("number");

-- CreateIndex
CREATE UNIQUE INDEX "project_quoteId_key" ON "project"("quoteId");

-- CreateIndex
CREATE INDEX "project_leadId_idx" ON "project"("leadId");

-- CreateIndex
CREATE INDEX "project_status_idx" ON "project"("status");

-- CreateIndex
CREATE INDEX "project_createdAt_idx" ON "project"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "milestone_projectId_position_idx" ON "milestone"("projectId", "position");

-- CreateIndex
CREATE INDEX "task_projectId_position_idx" ON "task"("projectId", "position");

-- CreateIndex
CREATE INDEX "task_assigneeId_idx" ON "task"("assigneeId");

-- CreateIndex
CREATE INDEX "task_status_idx" ON "task"("status");

-- CreateIndex
CREATE INDEX "task_dependency_dependsOnId_idx" ON "task_dependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "checklist_item_taskId_position_idx" ON "checklist_item"("taskId", "position");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules enforced by the database as well as by the application.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "project"
  ADD CONSTRAINT "project_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "project_dates_ordered"
    CHECK ("startDate" IS NULL OR "targetDate" IS NULL OR "targetDate" >= "startDate"),
  -- completedAt is set exactly when the project is completed.
  ADD CONSTRAINT "project_completed_at_matches" CHECK (("status" = 'completed') = ("completedAt" IS NOT NULL)),
  -- Work cannot have started without a written rollback plan.
  ADD CONSTRAINT "project_rollback_plan_before_work"
    CHECK ("status" NOT IN ('in_progress', 'on_hold', 'completed') OR length(btrim(coalesce("rollbackPlan", ''))) > 0),
  -- A completed project was handed over.
  ADD CONSTRAINT "project_handover_before_completion"
    CHECK ("status" <> 'completed' OR ("handoverAt" IS NOT NULL AND length(btrim(coalesce("handoverNotes", ''))) > 0)),
  -- A cancelled project says why.
  ADD CONSTRAINT "project_cancel_reason"
    CHECK ("status" <> 'cancelled' OR length(btrim(coalesce("cancelReason", ''))) > 0);

ALTER TABLE "milestone"
  ADD CONSTRAINT "milestone_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "milestone_position_non_negative" CHECK ("position" >= 0);

ALTER TABLE "task"
  ADD CONSTRAINT "task_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "task_position_non_negative" CHECK ("position" >= 0),
  ADD CONSTRAINT "task_completed_at_matches" CHECK (("status" = 'done') = ("completedAt" IS NOT NULL));

ALTER TABLE "checklist_item"
  ADD CONSTRAINT "checklist_text_not_blank" CHECK (length(btrim("text")) > 0),
  ADD CONSTRAINT "checklist_position_non_negative" CHECK ("position" >= 0),
  ADD CONSTRAINT "checklist_done_at_matches" CHECK ("done" = ("doneAt" IS NOT NULL));

ALTER TABLE "task_dependency"
  ADD CONSTRAINT "task_dependency_not_self" CHECK ("taskId" <> "dependsOnId");

-- A project is only created for a quotation the customer accepted, and starts as planned.
CREATE OR REPLACE FUNCTION project_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'planned' THEN
    RAISE EXCEPTION 'a project starts as planned';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "quote_revision" WHERE "quoteId" = NEW."quoteId" AND "status" = 'accepted'
  ) THEN
    RAISE EXCEPTION 'a project needs an accepted quotation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "quote" WHERE "id" = NEW."quoteId" AND "leadId" = NEW."leadId") THEN
    RAISE EXCEPTION 'the project lead must be the lead of its quotation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_insert_guard
BEFORE INSERT ON "project"
FOR EACH ROW EXECUTE FUNCTION project_insert_guard();

-- Identity never changes, finished projects are frozen, and status follows the state machine.
CREATE OR REPLACE FUNCTION project_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'projects are history and cannot be deleted';
  END IF;

  IF NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId"
     OR NEW."leadId" IS DISTINCT FROM OLD."leadId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'project identity is immutable';
  END IF;

  IF OLD."status" IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'a % project is final and cannot change', OLD."status";
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'planned'     AND NEW."status" IN ('in_progress', 'cancelled')) OR
      (OLD."status" = 'in_progress' AND NEW."status" IN ('on_hold', 'completed', 'cancelled')) OR
      (OLD."status" = 'on_hold'     AND NEW."status" IN ('in_progress', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'invalid project status change % -> %', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_guard
BEFORE UPDATE OR DELETE ON "project"
FOR EACH ROW EXECUTE FUNCTION project_guard();

CREATE OR REPLACE FUNCTION project_is_closed(project_id text) RETURNS boolean AS $$
  SELECT coalesce((SELECT "status" IN ('completed', 'cancelled') FROM "project" WHERE "id" = project_id), false);
$$ LANGUAGE sql STABLE;

-- Milestones, tasks, checklists and dependencies of a finished project are frozen.
CREATE OR REPLACE FUNCTION milestone_guard() RETURNS trigger AS $$
DECLARE pid text;
BEGIN
  pid := CASE WHEN TG_OP = 'DELETE' THEN OLD."projectId" ELSE NEW."projectId" END;
  IF project_is_closed(pid) THEN
    RAISE EXCEPTION 'the project is closed: its milestones cannot change';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    RAISE EXCEPTION 'a milestone cannot move to another project';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER milestone_guard
BEFORE INSERT OR UPDATE OR DELETE ON "milestone"
FOR EACH ROW EXECUTE FUNCTION milestone_guard();

CREATE OR REPLACE FUNCTION task_guard() RETURNS trigger AS $$
DECLARE pid text;
BEGIN
  pid := CASE WHEN TG_OP = 'DELETE' THEN OLD."projectId" ELSE NEW."projectId" END;
  IF project_is_closed(pid) THEN
    RAISE EXCEPTION 'the project is closed: its tasks cannot change';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    RAISE EXCEPTION 'a task cannot move to another project';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."milestoneId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "milestone" WHERE "id" = NEW."milestoneId" AND "projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'the milestone belongs to another project';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_guard
BEFORE INSERT OR UPDATE OR DELETE ON "task"
FOR EACH ROW EXECUTE FUNCTION task_guard();

CREATE OR REPLACE FUNCTION checklist_guard() RETURNS trigger AS $$
DECLARE tid text; pid text;
BEGIN
  tid := CASE WHEN TG_OP = 'DELETE' THEN OLD."taskId" ELSE NEW."taskId" END;
  SELECT "projectId" INTO pid FROM "task" WHERE "id" = tid;
  IF pid IS NOT NULL AND project_is_closed(pid) THEN
    RAISE EXCEPTION 'the project is closed: its checklists cannot change';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."taskId" IS DISTINCT FROM OLD."taskId" THEN
    RAISE EXCEPTION 'a checklist item cannot move to another task';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER checklist_guard
BEFORE INSERT OR UPDATE OR DELETE ON "checklist_item"
FOR EACH ROW EXECUTE FUNCTION checklist_guard();

-- Dependencies: same project, project open, and never a cycle.
CREATE OR REPLACE FUNCTION task_dependency_guard() RETURNS trigger AS $$
DECLARE task_project text; prerequisite_project text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "projectId" INTO task_project FROM "task" WHERE "id" = OLD."taskId";
    IF task_project IS NOT NULL AND project_is_closed(task_project) THEN
      RAISE EXCEPTION 'the project is closed: its dependencies cannot change';
    END IF;
    RETURN OLD;
  END IF;

  SELECT "projectId" INTO task_project FROM "task" WHERE "id" = NEW."taskId";
  SELECT "projectId" INTO prerequisite_project FROM "task" WHERE "id" = NEW."dependsOnId";
  IF task_project IS DISTINCT FROM prerequisite_project THEN
    RAISE EXCEPTION 'a task can only depend on a task of the same project';
  END IF;
  IF project_is_closed(task_project) THEN
    RAISE EXCEPTION 'the project is closed: its dependencies cannot change';
  END IF;
  IF EXISTS (
    WITH RECURSIVE reach("id") AS (
      SELECT NEW."dependsOnId"
      UNION
      SELECT d."dependsOnId" FROM "task_dependency" d JOIN reach r ON d."taskId" = r."id"
    )
    SELECT 1 FROM reach WHERE "id" = NEW."taskId"
  ) THEN
    RAISE EXCEPTION 'this dependency would create a cycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_dependency_guard
BEFORE INSERT OR UPDATE OR DELETE ON "task_dependency"
FOR EACH ROW EXECUTE FUNCTION task_dependency_guard();
