-- Docs & Links: each person's own saved documents and links.
CREATE TABLE "SavedDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "fileStoredName" TEXT,
    "fileName" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "brand" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedDoc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedDoc_userId_pinned_updatedAt_idx" ON "SavedDoc"("userId", "pinned", "updatedAt");

ALTER TABLE "SavedDoc" ADD CONSTRAINT "SavedDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
