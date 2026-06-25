-- Target now captures a min/max range. `value` stays as the headline goal.
ALTER TABLE "Target" ADD COLUMN "minValue" DOUBLE PRECISION;
ALTER TABLE "Target" ADD COLUMN "maxValue" DOUBLE PRECISION;
