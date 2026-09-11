-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "businessSuiteId" TEXT;

-- CreateTable
CREATE TABLE "BusinessSuite" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessManagerId" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSuite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSuite_departmentId_name_key" ON "BusinessSuite"("departmentId", "name");

-- CreateIndex
CREATE INDEX "BrandProfile_businessSuiteId_idx" ON "BrandProfile"("businessSuiteId");

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_businessSuiteId_fkey" FOREIGN KEY ("businessSuiteId") REFERENCES "BusinessSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSuite" ADD CONSTRAINT "BusinessSuite_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
