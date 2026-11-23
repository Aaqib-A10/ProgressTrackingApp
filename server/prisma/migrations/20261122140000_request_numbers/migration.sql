-- DropIndex
DROP INDEX "ApprovalRequest_number_key";

-- AlterTable
ALTER TABLE "ApprovalRequest" ALTER COLUMN "number" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_companyId_number_key" ON "ApprovalRequest"("companyId", "number");

DROP SEQUENCE IF EXISTS "ApprovalRequest_number_seq";
