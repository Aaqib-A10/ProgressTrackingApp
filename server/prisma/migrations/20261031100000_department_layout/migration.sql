-- Department Studio (Phase 2, part A): a department's own menu for its members and its team leads,
-- made of blocks (lib/blocks.ts). Empty = the menu that comes with its kind, as before.
ALTER TABLE "Department" ADD COLUMN "layout" JSONB;

-- The Studio starts switched off for 99 Technologies: their menus stay exactly as they are until
-- the owner turns it on (owner console, Switches).
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('department-studio', 'company-1', false, CURRENT_TIMESTAMP, 'Phase 2 setup')
ON CONFLICT ("key", "companyId") DO NOTHING;
