-- CreateTable
CREATE TABLE "DialerLead" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "externalId" TEXT,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "stateRaw" TEXT,
    "state" TEXT,
    "stateOverride" TEXT,
    "region" TEXT,
    "verifyZone" BOOLEAN NOT NULL DEFAULT false,
    "zoneOverride" TEXT,
    "industry" TEXT,
    "status" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "maxStage" INTEGER NOT NULL,
    "source" TEXT,
    "leadDate" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "inLatestImport" BOOLEAN NOT NULL DEFAULT true,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "dupResolved" BOOLEAN NOT NULL DEFAULT false,
    "sentToLeadGen" BOOLEAN NOT NULL DEFAULT false,
    "snoozeUntil" TIMESTAMP(3),
    "callLaterAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3),
    "raw" JSONB,
    "firstImportId" TEXT,
    "lastImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "headerSignature" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "funnel" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerStatusChange" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "fromStage" INTEGER,
    "toStage" INTEGER NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerAction" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerSettings" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DialerLead_matchKey_idx" ON "DialerLead"("matchKey");

-- CreateIndex
CREATE INDEX "DialerLead_ownerId_inLatestImport_idx" ON "DialerLead"("ownerId", "inLatestImport");

-- CreateIndex
CREATE UNIQUE INDEX "DialerLead_ownerId_matchKey_key" ON "DialerLead"("ownerId", "matchKey");

-- CreateIndex
CREATE INDEX "DialerImport_userId_createdAt_idx" ON "DialerImport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DialerStatusChange_leadId_createdAt_idx" ON "DialerStatusChange"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "DialerAction_leadId_createdAt_idx" ON "DialerAction"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "DialerLead" ADD CONSTRAINT "DialerLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerImport" ADD CONSTRAINT "DialerImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerStatusChange" ADD CONSTRAINT "DialerStatusChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerAction" ADD CONSTRAINT "DialerAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerAction" ADD CONSTRAINT "DialerAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

