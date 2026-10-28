-- Company-wise switches: a switch can be set differently for one company.
CREATE TABLE "FeatureFlagCompany" (
    "key" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "FeatureFlagCompany_pkey" PRIMARY KEY ("key","companyId")
);
CREATE INDEX "FeatureFlagCompany_companyId_idx" ON "FeatureFlagCompany"("companyId");
ALTER TABLE "FeatureFlagCompany" ADD CONSTRAINT "FeatureFlagCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
