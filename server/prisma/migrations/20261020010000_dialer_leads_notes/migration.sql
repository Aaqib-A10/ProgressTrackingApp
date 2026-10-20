-- AlterTable
ALTER TABLE "DialerLead" ADD COLUMN     "backlogKeptAt" TIMESTAMP(3),
ADD COLUMN     "bestTime" TEXT,
ADD COLUMN     "companySize" TEXT,
ADD COLUMN     "crmUpdateWhat" TEXT,
ADD COLUMN     "decisionMaker" TEXT,
ADD COLUMN     "email2" TEXT,
ADD COLUMN     "followUpDropped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "listName" TEXT NOT NULL DEFAULT 'CRM',
ADD COLUMN     "needsCrmUpdate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "DialerNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "nextActionAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerUserPrefs" (
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialerUserPrefs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DialerNote_leadId_createdAt_idx" ON "DialerNote"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "DialerNote_userId_createdAt_idx" ON "DialerNote"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DialerNote" ADD CONSTRAINT "DialerNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerNote" ADD CONSTRAINT "DialerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerUserPrefs" ADD CONSTRAINT "DialerUserPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Notes written before (kept as actions) move to the notes table, with author and time.
INSERT INTO "DialerNote" ("id", "leadId", "userId", "text", "createdAt")
SELECT 'n_' || "id", "leadId", "userId", "note", "createdAt" FROM "DialerAction" WHERE "kind" = 'NOTE' AND "note" IS NOT NULL;
DELETE FROM "DialerAction" WHERE "kind" = 'NOTE';
