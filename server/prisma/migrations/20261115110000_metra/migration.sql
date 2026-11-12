-- Metra, the AI assistant (docs/metra/DESIGN.md): indexed chunks, conversations, insights, index state. Additive only.
-- Rollback: drop the five Ai* tables (they are rebuilt from the source records); the AI_INSIGHT enum value can stay.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AI_INSIGHT';

-- CreateTable
CREATE TABLE "AiChunk" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "part" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "labels" TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "link" TEXT,
    "meta" JSONB,
    "embedding" BYTEA NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "tools" JSONB,
    "actions" JSONB,
    "feedback" TEXT,
    "feedbackNote" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiIndexState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL,
    "watermark" TIMESTAMP(3),
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiIndexState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChunk_companyId_sourceType_idx" ON "AiChunk"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "AiChunk_companyId_updatedAt_idx" ON "AiChunk"("companyId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiChunk_sourceType_sourceId_part_key" ON "AiChunk"("sourceType", "sourceId", "part");

-- CreateIndex
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiConversation_companyId_idx" ON "AiConversation"("companyId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessage_companyId_createdAt_idx" ON "AiMessage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInsight_companyId_idx" ON "AiInsight"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_userId_kind_day_subjectId_key" ON "AiInsight"("userId", "kind", "day", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "AiIndexState_companyId_sourceType_key" ON "AiIndexState"("companyId", "sourceType");

-- AddForeignKey
ALTER TABLE "AiChunk" ADD CONSTRAINT "AiChunk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiIndexState" ADD CONSTRAINT "AiIndexState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Company walls for the new tables (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_AiChunk"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AiChunk row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AiChunk_company_wall" ON "AiChunk";
CREATE TRIGGER "AiChunk_company_wall" BEFORE INSERT OR UPDATE ON "AiChunk" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AiChunk"();

CREATE OR REPLACE FUNCTION "mq_wall_AiConversation"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AiConversation row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: AiConversation.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AiConversation_company_wall" ON "AiConversation";
CREATE TRIGGER "AiConversation_company_wall" BEFORE INSERT OR UPDATE ON "AiConversation" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AiConversation"();

CREATE OR REPLACE FUNCTION "mq_wall_AiMessage"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AiMessage row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."conversationId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "AiConversation" WHERE "id" = NEW."conversationId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."conversationId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."conversationId" IS DISTINCT FROM OLD."conversationId") THEN
    SELECT "companyId" INTO c FROM "AiConversation" WHERE "id" = NEW."conversationId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: AiMessage.conversationId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AiMessage_company_wall" ON "AiMessage";
CREATE TRIGGER "AiMessage_company_wall" BEFORE INSERT OR UPDATE ON "AiMessage" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AiMessage"();

CREATE OR REPLACE FUNCTION "mq_wall_AiInsight"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AiInsight row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: AiInsight.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AiInsight_company_wall" ON "AiInsight";
CREATE TRIGGER "AiInsight_company_wall" BEFORE INSERT OR UPDATE ON "AiInsight" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AiInsight"();

CREATE OR REPLACE FUNCTION "mq_wall_AiIndexState"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AiIndexState row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AiIndexState_company_wall" ON "AiIndexState";
CREATE TRIGGER "AiIndexState_company_wall" BEFORE INSERT OR UPDATE ON "AiIndexState" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AiIndexState"();
