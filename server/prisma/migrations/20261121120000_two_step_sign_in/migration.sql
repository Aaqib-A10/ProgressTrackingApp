-- Two-step sign-in for company users (an authenticator app), and a company setting to require it. Off for everyone; nothing existing changes.
ALTER TABLE "User" ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "twoStepOn" TIMESTAMP(3),
ADD COLUMN     "twoStepRecovery" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN     "requireTwoStep" BOOLEAN NOT NULL DEFAULT false;
