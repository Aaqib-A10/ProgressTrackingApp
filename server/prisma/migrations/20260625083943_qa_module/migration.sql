-- CreateEnum
CREATE TYPE "QaQuestionType" AS ENUM ('RATING', 'YES_NO');

-- CreateEnum
CREATE TYPE "QaEvaluationStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'QA_RECORDING';

-- AlterEnum
ALTER TYPE "DepartmentType" ADD VALUE 'CSR';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'QA';

-- CreateTable
CREATE TABLE "QaScorecard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentType" "DepartmentType",
    "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 75,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaCategory" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QaCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaQuestion" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "QaQuestionType" NOT NULL DEFAULT 'RATING',
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "criticalFail" BOOLEAN NOT NULL DEFAULT false,
    "allowNA" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QaQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvaluation" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT,
    "scorecardName" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "departmentId" TEXT,
    "callReference" TEXT,
    "callDate" TIMESTAMP(3),
    "recordingAttachmentId" TEXT,
    "status" "QaEvaluationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "criticalFailTriggered" BOOLEAN NOT NULL DEFAULT false,
    "coachingNeeded" BOOLEAN NOT NULL DEFAULT false,
    "overallComments" TEXT,
    "agentReadAt" TIMESTAMP(3),
    "agentAcknowledgedAt" TIMESTAMP(3),
    "agentRebuttal" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvaluationCategory" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "scorePct" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QaEvaluationCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaAnswer" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "type" "QaQuestionType" NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "criticalFail" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "isNA" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QaAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaCategory_scorecardId_idx" ON "QaCategory"("scorecardId");

-- CreateIndex
CREATE INDEX "QaQuestion_categoryId_idx" ON "QaQuestion"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "QaEvaluation_recordingAttachmentId_key" ON "QaEvaluation"("recordingAttachmentId");

-- CreateIndex
CREATE INDEX "QaEvaluation_agentId_idx" ON "QaEvaluation"("agentId");

-- CreateIndex
CREATE INDEX "QaEvaluation_evaluatorId_idx" ON "QaEvaluation"("evaluatorId");

-- CreateIndex
CREATE INDEX "QaEvaluation_departmentId_createdAt_idx" ON "QaEvaluation"("departmentId", "createdAt");

-- CreateIndex
CREATE INDEX "QaEvaluationCategory_evaluationId_idx" ON "QaEvaluationCategory"("evaluationId");

-- CreateIndex
CREATE INDEX "QaAnswer_evaluationId_idx" ON "QaAnswer"("evaluationId");

-- AddForeignKey
ALTER TABLE "QaScorecard" ADD CONSTRAINT "QaScorecard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCategory" ADD CONSTRAINT "QaCategory_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "QaScorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaQuestion" ADD CONSTRAINT "QaQuestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QaCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "QaScorecard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_recordingAttachmentId_fkey" FOREIGN KEY ("recordingAttachmentId") REFERENCES "EntryAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluationCategory" ADD CONSTRAINT "QaEvaluationCategory_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "QaEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaAnswer" ADD CONSTRAINT "QaAnswer_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "QaEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
