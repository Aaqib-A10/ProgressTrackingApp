-- Department sections: a company turns screens of a department's kind on or off (nothing deleted).
ALTER TABLE "Department" ADD COLUMN "sectionsOff" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Department" SET "sectionsOff" = ARRAY[]::TEXT[] WHERE "sectionsOff" IS NULL;
ALTER TABLE "Department" ALTER COLUMN "sectionsOff" SET NOT NULL;
