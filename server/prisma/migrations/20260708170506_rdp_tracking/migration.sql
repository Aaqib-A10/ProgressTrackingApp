-- CreateEnum
CREATE TYPE "RdpTeam" AS ENUM ('EC', 'CSR', 'SHIPPING');

-- CreateTable
CREATE TABLE "Rdp" (
    "id" TEXT NOT NULL,
    "team" "RdpTeam" NOT NULL,
    "provider" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rdp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RdpAssignment" (
    "id" TEXT NOT NULL,
    "rdpId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RdpAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rdp_team_idx" ON "Rdp"("team");

-- CreateIndex
CREATE UNIQUE INDEX "Rdp_provider_address_key" ON "Rdp"("provider", "address");

-- CreateIndex
CREATE INDEX "RdpAssignment_rdpId_idx" ON "RdpAssignment"("rdpId");

-- CreateIndex
CREATE INDEX "RdpAssignment_agentName_idx" ON "RdpAssignment"("agentName");

-- AddForeignKey
ALTER TABLE "RdpAssignment" ADD CONSTRAINT "RdpAssignment_rdpId_fkey" FOREIGN KEY ("rdpId") REFERENCES "Rdp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
