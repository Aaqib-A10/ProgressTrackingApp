-- The new parts of plan 2026-11 (Requests, People, Quotes and invoices, Report builder, Import, the project extras,
-- and Metra speaking first: alerts, the weekly summary, the dashboard strip) start switched off for
-- 99 Technologies: their screens and notifications stay as they are until the owner turns each one on (owner console, Switches).
-- Every other company has them on.
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
SELECT k, 'company-1', false, CURRENT_TIMESTAMP, 'Plan 2026-11 setup'
FROM unnest(ARRAY['requests', 'people-records', 'sales-docs', 'report-builder', 'data-import', 'project-extras', 'metra-proactive']) AS k
WHERE EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'company-1')
ON CONFLICT ("key", "companyId") DO NOTHING;
