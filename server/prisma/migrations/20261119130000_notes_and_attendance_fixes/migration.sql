-- Notes (sticky notes, shared with people) and attendance fix requests (a forgotten check-in, asked for and approved).
-- Additive only: three new tables and five notification types. Rollback: drop the three tables (the enum values can stay).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NOTE_SHARED';
ALTER TYPE "NotificationType" ADD VALUE 'NOTE_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'NOTE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_FIX_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_FIX_DECIDED';

-- CreateTable
CREATE TABLE "AttendanceFixRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TEXT NOT NULL,
    "checkOut" TEXT,
    "reason" TEXT NOT NULL,
    "status" "WfhRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceFixRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "items" JSONB,
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "tags" TEXT[],
    "mentions" TEXT[],
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "remindAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteShare" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceFixRequest_userId_status_idx" ON "AttendanceFixRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "AttendanceFixRequest_status_createdAt_idx" ON "AttendanceFixRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceFixRequest_companyId_idx" ON "AttendanceFixRequest"("companyId");

-- CreateIndex
CREATE INDEX "Note_ownerId_archived_updatedAt_idx" ON "Note"("ownerId", "archived", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_remindAt_idx" ON "Note"("remindAt");

-- CreateIndex
CREATE INDEX "Note_companyId_idx" ON "Note"("companyId");

-- CreateIndex
CREATE INDEX "NoteShare_userId_idx" ON "NoteShare"("userId");

-- CreateIndex
CREATE INDEX "NoteShare_companyId_idx" ON "NoteShare"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteShare_noteId_userId_key" ON "NoteShare"("noteId", "userId");

-- AddForeignKey
ALTER TABLE "AttendanceFixRequest" ADD CONSTRAINT "AttendanceFixRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFixRequest" ADD CONSTRAINT "AttendanceFixRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFixRequest" ADD CONSTRAINT "AttendanceFixRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Company walls for the new tables (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_AttendanceFixRequest"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a AttendanceFixRequest row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    IF c IS NULL AND NEW."decidedById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."decidedById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: AttendanceFixRequest.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."decidedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."decidedById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: AttendanceFixRequest.decidedById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AttendanceFixRequest_company_wall" ON "AttendanceFixRequest";
CREATE TRIGGER "AttendanceFixRequest_company_wall" BEFORE INSERT OR UPDATE ON "AttendanceFixRequest" FOR EACH ROW EXECUTE FUNCTION "mq_wall_AttendanceFixRequest"();

CREATE OR REPLACE FUNCTION "mq_wall_Note"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a Note row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."ownerId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."ownerId"; END IF;
    IF c IS NULL AND NEW."editedById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."editedById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."ownerId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."ownerId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Note.ownerId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."editedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."editedById" IS DISTINCT FROM OLD."editedById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."editedById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Note.editedById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "Note_company_wall" ON "Note";
CREATE TRIGGER "Note_company_wall" BEFORE INSERT OR UPDATE ON "Note" FOR EACH ROW EXECUTE FUNCTION "mq_wall_Note"();

CREATE OR REPLACE FUNCTION "mq_wall_NoteShare"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a NoteShare row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."noteId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Note" WHERE "id" = NEW."noteId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."noteId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."noteId" IS DISTINCT FROM OLD."noteId") THEN
    SELECT "companyId" INTO c FROM "Note" WHERE "id" = NEW."noteId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: NoteShare.noteId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: NoteShare.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "NoteShare_company_wall" ON "NoteShare";
CREATE TRIGGER "NoteShare_company_wall" BEFORE INSERT OR UPDATE ON "NoteShare" FOR EACH ROW EXECUTE FUNCTION "mq_wall_NoteShare"();
