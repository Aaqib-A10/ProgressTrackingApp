-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('GOOGLE', 'META');

-- CreateEnum
CREATE TYPE "AdCampaignType" AS ENUM ('SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'OTHER');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "BlogStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "status" "BlogStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "MarketingTask" ADD COLUMN     "platform" "SocialPlatform";

-- AlterTable
ALTER TABLE "SeoDailyEntry" ADD COLUMN     "body" TEXT;

-- CreateTable
CREATE TABLE "ContentDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "body" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "month" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "campaignType" "AdCampaignType" NOT NULL DEFAULT 'OTHER',
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "leads" INTEGER NOT NULL DEFAULT 0,
    "businessLeads" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "spend" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDailyEntry_date_idx" ON "ContentDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDailyEntry_userId_date_key" ON "ContentDailyEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "AdCampaign_brandId_platform_month_idx" ON "AdCampaign"("brandId", "platform", "month");

-- CreateIndex
CREATE INDEX "AdCampaign_month_idx" ON "AdCampaign"("month");

-- CreateIndex
CREATE INDEX "MarketingTask_discipline_scheduledDate_idx" ON "MarketingTask"("discipline", "scheduledDate");

-- AddForeignKey
ALTER TABLE "ContentDailyEntry" ADD CONSTRAINT "ContentDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
