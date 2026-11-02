-- Takes 20261103100000_lead_management back out (run by hand with psql if ever needed, then
-- delete the row for this migration from "_prisma_migrations"). Removes every lead and business.
-- The three LEAD_* notification types stay in the enum (Postgres cannot drop enum values); unused.
DROP TRIGGER IF EXISTS "LeadEvent_company_wall" ON "LeadEvent";
DROP FUNCTION IF EXISTS "mq_wall_LeadEvent"();
DROP TRIGGER IF EXISTS "Lead_company_wall" ON "Lead";
DROP FUNCTION IF EXISTS "mq_wall_Lead"();
DROP TRIGGER IF EXISTS "LeadBusinessMember_company_wall" ON "LeadBusinessMember";
DROP FUNCTION IF EXISTS "mq_wall_LeadBusinessMember"();
DROP TRIGGER IF EXISTS "LeadBusiness_company_wall" ON "LeadBusiness";
DROP FUNCTION IF EXISTS "mq_wall_LeadBusiness"();
DELETE FROM "Notification" WHERE "type"::text IN ('LEAD_NEW', 'LEAD_ASSIGNED', 'LEAD_SLA');
DROP TABLE IF EXISTS "LeadEvent";
DROP TABLE IF EXISTS "Lead";
DROP TABLE IF EXISTS "LeadBusinessMember";
DROP TABLE IF EXISTS "LeadBusiness";
DELETE FROM "FeatureFlagCompany" WHERE "key" = 'lead-management';
DELETE FROM "FeatureFlag" WHERE "key" = 'lead-management';
