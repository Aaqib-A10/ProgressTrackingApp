-- Live updates start switched off for 99 Technologies: their tabs keep checking on a timer exactly as before, until
-- the owner turns it on (owner console, Switches). Every other company has it on.
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
SELECT 'live-updates', 'company-1', false, CURRENT_TIMESTAMP, 'Plan 2026-11 setup'
WHERE EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'company-1')
ON CONFLICT ("key", "companyId") DO NOTHING;
