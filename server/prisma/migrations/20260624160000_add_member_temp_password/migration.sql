-- Stores the last issued temporary password so a Team Lead can view/copy it
-- from the team roster until the member sets their own password.
ALTER TABLE "User" ADD COLUMN "tempPassword" TEXT;
