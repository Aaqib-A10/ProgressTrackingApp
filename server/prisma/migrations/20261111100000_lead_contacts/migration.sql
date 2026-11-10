-- CreateTable
CREATE TABLE "LeadContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneE164" TEXT,
    "mobile" TEXT,
    "decisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadContact_leadId_idx" ON "LeadContact"("leadId");

-- CreateIndex
CREATE INDEX "LeadContact_companyId_phoneE164_idx" ON "LeadContact"("companyId", "phoneE164");

-- CreateIndex
CREATE INDEX "LeadContact_companyId_businessId_name_idx" ON "LeadContact"("companyId", "businessId", "name");

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Company wall for the new table (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_LeadContact"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadContact row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadContact.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadContact_company_wall" ON "LeadContact";
CREATE TRIGGER "LeadContact_company_wall" BEFORE INSERT OR UPDATE ON "LeadContact" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadContact"();

-- The deal board and contacts start switched off for 99 Technologies: their Leads menu and lead page stay as they are until the owner turns it on (owner console, Switches).
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('deal-board', 'company-1', false, CURRENT_TIMESTAMP, 'CRM setup')
ON CONFLICT ("key", "companyId") DO NOTHING;
