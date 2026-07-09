-- Add "Work From Home" as a leave type. WFH is a worked day (person can still
-- clock in and their metrics count) but is recorded like other leave markers.
ALTER TYPE "LeaveType" ADD VALUE 'WFH';
