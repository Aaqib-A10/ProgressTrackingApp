-- A company's own logo (shown in its sidebar; the picture itself is a file, like profile pictures). Empty for everyone.
ALTER TABLE "Company" ADD COLUMN     "logoAt" TIMESTAMP(3);
