-- ITAD update 12 Nov 2026 (docs/itad-notes/DESIGN.md): Earth Zone sync fields, note sources and overrides,
-- second contacts, Claude log, auto-closed follow-ups, muted notification categories. Additive only.
-- Rollback: drop the new columns and the DialerContact table; DialerNote.userId may be set NOT NULL again once
-- notes without a Metriq author are removed.

-- AlterTable
ALTER TABLE "DialerAction" ADD COLUMN     "field" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "value" TEXT;

-- AlterTable
ALTER TABLE "DialerLead" ADD COLUMN     "altPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "ezLeadId" TEXT,
ADD COLUMN     "ezLinks" JSONB,
ADD COLUMN     "ezSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DialerNote" ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "ezKey" TEXT,
ADD COLUMN     "ezText" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'METRIQ',
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyMuted" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WorkLogEntry" ADD COLUMN     "autoClosedBy" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DialerContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedin" TEXT,
    "state" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "noteId" TEXT,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialerContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DialerContact_companyId_idx" ON "DialerContact"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DialerContact_leadId_key_key" ON "DialerContact"("leadId", "key");

-- CreateIndex
CREATE INDEX "DialerAction_companyId_source_createdAt_idx" ON "DialerAction"("companyId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "DialerLead_ownerId_ezLeadId_idx" ON "DialerLead"("ownerId", "ezLeadId");

-- CreateIndex
CREATE INDEX "DialerNote_companyId_source_createdAt_idx" ON "DialerNote"("companyId", "source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DialerNote_leadId_ezKey_key" ON "DialerNote"("leadId", "ezKey");

-- AddForeignKey
ALTER TABLE "DialerContact" ADD CONSTRAINT "DialerContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerContact" ADD CONSTRAINT "DialerContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Company wall for the new table (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_DialerContact"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a DialerContact row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."leadId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: DialerContact.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "DialerContact_company_wall" ON "DialerContact";
CREATE TRIGGER "DialerContact_company_wall" BEFORE INSERT OR UPDATE ON "DialerContact" FOR EACH ROW EXECUTE FUNCTION "mq_wall_DialerContact"();
