-- AlterTable
ALTER TABLE "AdCampaign" ADD COLUMN     "date" DATE,
ALTER COLUMN "spend" SET DEFAULT 0,
ALTER COLUMN "spend" SET DATA TYPE DECIMAL(12,2);

-- Backfill legacy rows: give each existing campaign a date on the 1st of its month.
UPDATE "AdCampaign" SET "date" = ("month" || '-01')::date WHERE "date" IS NULL;

-- CreateIndex
CREATE INDEX "AdCampaign_brandId_date_idx" ON "AdCampaign"("brandId", "date");
