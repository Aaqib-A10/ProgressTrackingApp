-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "ga4PropertyId" TEXT,
ADD COLUMN     "gscSiteUrl" TEXT,
ADD COLUMN     "seoSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BrandSeoDaily" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "engagedSessions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "StatSource" NOT NULL DEFAULT 'API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSeoDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandSeoDaily_brandId_date_idx" ON "BrandSeoDaily"("brandId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSeoDaily_brandId_date_key" ON "BrandSeoDaily"("brandId", "date");

-- AddForeignKey
ALTER TABLE "BrandSeoDaily" ADD CONSTRAINT "BrandSeoDaily_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
