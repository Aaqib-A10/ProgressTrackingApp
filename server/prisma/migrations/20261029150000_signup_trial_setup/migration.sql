-- Phase 1, step 7: sign-up, email check, free trial and the setup wizard.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "sampleIds" JSONB,
ADD COLUMN     "setupDoneAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCheckPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "microsoftId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_microsoftId_key" ON "User"("microsoftId");


-- Everyone already in Metriq counts as having confirmed their email.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
-- Companies from before do not need the setup wizard.
UPDATE "Company" SET "setupDoneAt" = "createdAt" WHERE "setupDoneAt" IS NULL;
