-- Overtime after the automatic check-out: the time between the check-out and pressing
-- "Start overtime" is kept as "off the clock" (not work, not a break).
ALTER TYPE "BreakType" ADD VALUE IF NOT EXISTS 'OFF';
