-- Takes 20261105100000_talkloop_calls back out (run by hand with psql if ever needed, then delete the row
-- for this migration from "_prisma_migrations"). Calls the phone system reported stay as plain calls.
ALTER TABLE "LeadCall" DROP COLUMN IF EXISTS "transcript", DROP COLUMN IF EXISTS "recordingFile", DROP COLUMN IF EXISTS "phone", DROP COLUMN IF EXISTS "provider";
DROP INDEX IF EXISTS "User_talkloopUserId_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "talkloopExt", DROP COLUMN IF EXISTS "talkloopUserId";
