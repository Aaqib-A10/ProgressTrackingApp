-- Predictive dialer (ITAD, Oct 2026): call results from the dialer land on the lead. Adds only; nothing existing changes.
-- AlterTable
ALTER TABLE "DialerLead" ADD COLUMN     "doNotCall" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doNotCallAt" TIMESTAMP(3),
ADD COLUMN     "wrongNumber" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DialerIntegration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fieldMap" JSONB NOT NULL,
    "dispositionMap" JSONB NOT NULL,
    "agentMap" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastReceivedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerCall" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalCallId" TEXT NOT NULL,
    "leadId" TEXT,
    "matchedBy" TEXT,
    "agentId" TEXT,
    "agentRaw" TEXT,
    "phone" TEXT,
    "disposition" TEXT NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "durationSec" INTEGER,
    "calledAt" TIMESTAMP(3) NOT NULL,
    "callbackAt" TIMESTAMP(3),
    "effect" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DialerIntegration_tokenHash_key" ON "DialerIntegration"("tokenHash");

-- CreateIndex
CREATE INDEX "DialerCall_leadId_calledAt_idx" ON "DialerCall"("leadId", "calledAt");

-- CreateIndex
CREATE INDEX "DialerCall_integrationId_createdAt_idx" ON "DialerCall"("integrationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DialerCall_integrationId_externalCallId_key" ON "DialerCall"("integrationId", "externalCallId");

-- AddForeignKey
ALTER TABLE "DialerCall" ADD CONSTRAINT "DialerCall_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "DialerIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerCall" ADD CONSTRAINT "DialerCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerCall" ADD CONSTRAINT "DialerCall_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

