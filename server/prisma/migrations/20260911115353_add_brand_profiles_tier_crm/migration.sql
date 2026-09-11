-- CreateEnum
CREATE TYPE "ServiceTier" AS ENUM ('TIER_1', 'TIER_2', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT', 'SALESFORCE', 'ZOHO', 'PIPEDRIVE', 'MONDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmStatus" AS ENUM ('NONE', 'PLANNED', 'IN_PROGRESS', 'CONNECTED');

-- CreateEnum
CREATE TYPE "ProfilePlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'REDDIT', 'YOUTUBE', 'TIKTOK', 'WEBSITE', 'GOOGLE_BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "crmAccount" TEXT,
ADD COLUMN     "crmCheckedAt" TIMESTAMP(3),
ADD COLUMN     "crmNote" TEXT,
ADD COLUMN     "crmProvider" "CrmProvider",
ADD COLUMN     "crmStatus" "CrmStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "tier" "ServiceTier" NOT NULL DEFAULT 'TIER_1';

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "ProfilePlatform" NOT NULL,
    "handle" TEXT,
    "url" TEXT,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandProfile_brandId_idx" ON "BrandProfile"("brandId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
