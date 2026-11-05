-- AI-drafted call notes from the transcript (for the SDR to confirm) and click-to-call placeholders.
ALTER TABLE "LeadCall" ADD COLUMN "aiSummary" TEXT,
                       ADD COLUMN "aiFacts" JSONB,
                       ADD COLUMN "aiAt" TIMESTAMP(3),
                       ADD COLUMN "aiAppliedAt" TIMESTAMP(3),
                       ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false;
