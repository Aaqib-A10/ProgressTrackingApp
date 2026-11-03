-- Takes 20261104100000_leads_like_leadwise_and_cmr back out (run by hand with psql if ever needed, then
-- delete the row for this migration from "_prisma_migrations"). Removes every call, comment, task, list and report; leads stay.
-- The enum values (DepartmentType CMR, the LEAD_TASK/COMMENT/REVIEW/DECISION notification types) stay: Postgres cannot drop enum values.
DROP TRIGGER IF EXISTS "LeadDailyReport_company_wall" ON "LeadDailyReport";
DROP FUNCTION IF EXISTS "mq_wall_LeadDailyReport"();
DROP TRIGGER IF EXISTS "LeadListEntry_company_wall" ON "LeadListEntry";
DROP FUNCTION IF EXISTS "mq_wall_LeadListEntry"();
DROP TRIGGER IF EXISTS "LeadTask_company_wall" ON "LeadTask";
DROP FUNCTION IF EXISTS "mq_wall_LeadTask"();
DROP TRIGGER IF EXISTS "LeadComment_company_wall" ON "LeadComment";
DROP FUNCTION IF EXISTS "mq_wall_LeadComment"();
DROP TRIGGER IF EXISTS "LeadCall_company_wall" ON "LeadCall";
DROP FUNCTION IF EXISTS "mq_wall_LeadCall"();
DROP TRIGGER IF EXISTS "LeadCmr_company_wall" ON "LeadCmr";
DROP FUNCTION IF EXISTS "mq_wall_LeadCmr"();
DELETE FROM "Notification" WHERE "type"::text IN ('LEAD_TASK', 'LEAD_COMMENT', 'LEAD_REVIEW', 'LEAD_DECISION');
DROP TABLE IF EXISTS "LeadDailyReport";
DROP TABLE IF EXISTS "LeadListEntry";
DROP TABLE IF EXISTS "LeadTask";
DROP TABLE IF EXISTS "LeadComment";
DROP TABLE IF EXISTS "LeadCall";
DROP TABLE IF EXISTS "LeadCmr";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "lostNote", DROP COLUMN IF EXISTS "jobTitle", DROP COLUMN IF EXISTS "employees", DROP COLUMN IF EXISTS "industry", DROP COLUMN IF EXISTS "website", DROP COLUMN IF EXISTS "websiteKey",
  DROP COLUMN IF EXISTS "mobile", DROP COLUMN IF EXISTS "ext", DROP COLUMN IF EXISTS "secondaryEmail", DROP COLUMN IF EXISTS "secondaryContact", DROP COLUMN IF EXISTS "recipientName", DROP COLUMN IF EXISTS "recipientEmail",
  DROP COLUMN IF EXISTS "tags", DROP COLUMN IF EXISTS "street", DROP COLUMN IF EXISTS "city", DROP COLUMN IF EXISTS "state", DROP COLUMN IF EXISTS "zip", DROP COLUMN IF EXISTS "country", DROP COLUMN IF EXISTS "productInfo",
  DROP COLUMN IF EXISTS "orgKey", DROP COLUMN IF EXISTS "phoneE164", DROP COLUMN IF EXISTS "nextStep", DROP COLUMN IF EXISTS "nextStepDate", DROP COLUMN IF EXISTS "owner", DROP COLUMN IF EXISTS "callsCount",
  DROP COLUMN IF EXISTS "firstCallAt", DROP COLUMN IF EXISTS "lastCallAt", DROP COLUMN IF EXISTS "prohibited", DROP COLUMN IF EXISTS "existingCustomer";
ALTER TABLE "LeadBusiness" DROP CONSTRAINT IF EXISTS "LeadBusiness_headId_fkey";
ALTER TABLE "LeadBusiness" DROP COLUMN IF EXISTS "kind", DROP COLUMN IF EXISTS "pipeline", DROP COLUMN IF EXISTS "settings", DROP COLUMN IF EXISTS "headId";
UPDATE "User" SET "departmentId" = NULL WHERE "departmentId" IN (SELECT "id" FROM "Department" WHERE "type" = 'CMR');
DELETE FROM "Department" WHERE "type" = 'CMR';
DELETE FROM "FeatureFlagCompany" WHERE "key" = 'cmr';
DELETE FROM "FeatureFlag" WHERE "key" = 'cmr';
