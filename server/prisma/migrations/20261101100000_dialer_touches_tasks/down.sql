-- Takes 20261101100000_dialer_touches_tasks back out (run by hand with psql if ever needed, then
-- delete the row for this migration from "_prisma_migrations"). Lead Dialer tasks become plain
-- My To-Do entries again; touches are removed.
DROP TRIGGER IF EXISTS "DialerTouch_company_wall" ON "DialerTouch";
DROP FUNCTION IF EXISTS "mq_wall_DialerTouch"();
DROP TABLE IF EXISTS "DialerTouch";
ALTER TABLE "WorkLogEntry" DROP CONSTRAINT IF EXISTS "WorkLogEntry_dialerLeadId_fkey";
DROP INDEX IF EXISTS "WorkLogEntry_dialerLeadId_idx";
DROP INDEX IF EXISTS "WorkLogEntry_userId_dueAt_idx";
ALTER TABLE "WorkLogEntry" DROP COLUMN IF EXISTS "dialerLeadId", DROP COLUMN IF EXISTS "taskKind", DROP COLUMN IF EXISTS "dueAt",
  DROP COLUMN IF EXISTS "origin", DROP COLUMN IF EXISTS "autoReason", DROP COLUMN IF EXISTS "outcome", DROP COLUMN IF EXISTS "cancelledAt",
  DROP COLUMN IF EXISTS "cancelReason", DROP COLUMN IF EXISTS "remindMinutes", DROP COLUMN IF EXISTS "remindersSent";
ALTER TABLE "DialerLead" DROP COLUMN IF EXISTS "jobTitle", DROP COLUMN IF EXISTS "assignedTo";
-- The to-do's company wall as it was before the link to a lead.
CREATE OR REPLACE FUNCTION "mq_wall_WorkLogEntry"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a WorkLogEntry row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: WorkLogEntry.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "WorkLogEntry_company_wall" ON "WorkLogEntry";
CREATE TRIGGER "WorkLogEntry_company_wall" BEFORE INSERT OR UPDATE ON "WorkLogEntry" FOR EACH ROW EXECUTE FUNCTION "mq_wall_WorkLogEntry"();
