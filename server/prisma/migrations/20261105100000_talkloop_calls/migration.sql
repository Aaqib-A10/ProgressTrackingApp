-- TalkLoop: link people to their TalkLoop user, and keep what the phone system reports about a call.
ALTER TABLE "User" ADD COLUMN "talkloopUserId" INTEGER,
                   ADD COLUMN "talkloopExt" TEXT;
CREATE UNIQUE INDEX "User_talkloopUserId_key" ON "User"("talkloopUserId");

ALTER TABLE "LeadCall" ADD COLUMN "provider" TEXT,
                       ADD COLUMN "phone" TEXT,
                       ADD COLUMN "recordingFile" TEXT,
                       ADD COLUMN "transcript" TEXT;
