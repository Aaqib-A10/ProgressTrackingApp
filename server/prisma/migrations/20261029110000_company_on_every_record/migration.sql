-- Phase 1, step 2: a company on every record.
-- Every table that holds a company's data gets "companyId". Adding a column with a fixed
-- default is instant in PostgreSQL (no table rewrite) and every existing row reads as
-- 'company-1' (99 Technologies) straight away, so nothing has to be copied in batches and the
-- running app keeps working while this runs.
-- The next migration adds the walls (triggers) and then makes the default '' (no company):
-- from then on new rows get their company from the app (lib/tenancy) or from the trigger.

-- People with no company yet are 99 Technologies' people.
UPDATE "User" SET "companyId" = 'company-1' WHERE "companyId" IS NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_companyId_fkey";

-- DropIndex
DROP INDEX "Department_type_key";

-- DropIndex
DROP INDEX "Holiday_date_key";

-- DropIndex
DROP INDEX "LeadGenBreakdown_month_category_key";

-- DropIndex
DROP INDEX "PmProject_key_key";

-- DropIndex
DROP INDEX "PmProject_name_key";

-- DropIndex
DROP INDEX "PmTask_code_key";

-- DropIndex
DROP INDEX "Rdp_provider_address_key";

-- DropIndex
DROP INDEX "SentMonthlyReport_month_department_key";

-- AlterTable
ALTER TABLE "AdCampaign" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "AttendanceReminder" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "AttendanceShift" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "AttendanceViolation" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BlockedCheckIn" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BrandSeoDaily" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BrandSocialMonthly" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BreakEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "BusinessSuite" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "CallRecording" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "CallTranscriptLine" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ChatCall" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ChatMember" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ChatReaction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ClaudeKey" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ContentDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerAction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerCall" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerImport" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerIntegration" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerLead" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerNote" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerSettings" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerStatusChange" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "DialerUserPrefs" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "EcomTaskComment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "EcommerceDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "EcommerceListingLine" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "EcommerceTask" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "EntryAttachment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "FeedbackReply" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "ItadDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "LeadGenBreakdown" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "LeadGenDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "LeadGenVerticalCount" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "LeaveDay" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "LoginEvent" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MarketingPlan" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MarketingPlanItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MarketingTask" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MarketingTaskComment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MeetingAttendee" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "MeetingNote" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "OfficeNetwork" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmActivity" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmAttachment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmChecklistItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmColumn" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmComment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmDispatchLog" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmExtensionRequest" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmLabel" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmNotifyPref" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmProject" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmProjectMember" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmReview" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmTask" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmTaskAssignee" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmTaskLabel" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PmTaskWatcher" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaAnswer" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaCategory" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaEvaluation" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaEvaluationCategory" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaQuestion" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "QaScorecard" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Rdp" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "RdpAssignment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SalaryRecord" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SavedDoc" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SearchTermPage" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SentMonthlyReport" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SeoDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SocialDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SocialPlatformCount" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "StockRequest" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SubDepartment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "SupportTicket" ALTER COLUMN "companyId" SET DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "TalkloopCountryCount" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "TalkloopDailyEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "TeamMemberEvent" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "companyId" SET NOT NULL,
ALTER COLUMN "companyId" SET DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "UserDepartment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "WfhRequest" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "WorkLogEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "WorkLogNote" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- AlterTable
ALTER TABLE "WorkLogReview" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-1';

-- CreateIndex
CREATE INDEX "AdCampaign_companyId_idx" ON "AdCampaign"("companyId");

-- CreateIndex
CREATE INDEX "AttendanceDay_companyId_idx" ON "AttendanceDay"("companyId");

-- CreateIndex
CREATE INDEX "AttendanceReminder_companyId_idx" ON "AttendanceReminder"("companyId");

-- CreateIndex
CREATE INDEX "AttendanceShift_companyId_idx" ON "AttendanceShift"("companyId");

-- CreateIndex
CREATE INDEX "AttendanceViolation_companyId_idx" ON "AttendanceViolation"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "Bid_companyId_idx" ON "Bid"("companyId");

-- CreateIndex
CREATE INDEX "BlockedCheckIn_companyId_idx" ON "BlockedCheckIn"("companyId");

-- CreateIndex
CREATE INDEX "BlogPost_companyId_idx" ON "BlogPost"("companyId");

-- CreateIndex
CREATE INDEX "Brand_companyId_idx" ON "Brand"("companyId");

-- CreateIndex
CREATE INDEX "BrandProfile_companyId_idx" ON "BrandProfile"("companyId");

-- CreateIndex
CREATE INDEX "BrandSeoDaily_companyId_idx" ON "BrandSeoDaily"("companyId");

-- CreateIndex
CREATE INDEX "BrandSocialMonthly_companyId_idx" ON "BrandSocialMonthly"("companyId");

-- CreateIndex
CREATE INDEX "BreakEntry_companyId_idx" ON "BreakEntry"("companyId");

-- CreateIndex
CREATE INDEX "BusinessSuite_companyId_idx" ON "BusinessSuite"("companyId");

-- CreateIndex
CREATE INDEX "CallRecording_companyId_idx" ON "CallRecording"("companyId");

-- CreateIndex
CREATE INDEX "CallTranscriptLine_companyId_idx" ON "CallTranscriptLine"("companyId");

-- CreateIndex
CREATE INDEX "ChatCall_companyId_idx" ON "ChatCall"("companyId");

-- CreateIndex
CREATE INDEX "ChatConversation_companyId_idx" ON "ChatConversation"("companyId");

-- CreateIndex
CREATE INDEX "ChatMember_companyId_idx" ON "ChatMember"("companyId");

-- CreateIndex
CREATE INDEX "ChatMessage_companyId_idx" ON "ChatMessage"("companyId");

-- CreateIndex
CREATE INDEX "ChatReaction_companyId_idx" ON "ChatReaction"("companyId");

-- CreateIndex
CREATE INDEX "ClaudeKey_companyId_idx" ON "ClaudeKey"("companyId");

-- CreateIndex
CREATE INDEX "ContentDailyEntry_companyId_idx" ON "ContentDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_type_key" ON "Department"("companyId", "type");

-- CreateIndex
CREATE INDEX "DialerAction_companyId_idx" ON "DialerAction"("companyId");

-- CreateIndex
CREATE INDEX "DialerCall_companyId_idx" ON "DialerCall"("companyId");

-- CreateIndex
CREATE INDEX "DialerImport_companyId_idx" ON "DialerImport"("companyId");

-- CreateIndex
CREATE INDEX "DialerIntegration_companyId_idx" ON "DialerIntegration"("companyId");

-- CreateIndex
CREATE INDEX "DialerLead_companyId_idx" ON "DialerLead"("companyId");

-- CreateIndex
CREATE INDEX "DialerNote_companyId_idx" ON "DialerNote"("companyId");

-- CreateIndex
CREATE INDEX "DialerSettings_companyId_idx" ON "DialerSettings"("companyId");

-- CreateIndex
CREATE INDEX "DialerStatusChange_companyId_idx" ON "DialerStatusChange"("companyId");

-- CreateIndex
CREATE INDEX "DialerUserPrefs_companyId_idx" ON "DialerUserPrefs"("companyId");

-- CreateIndex
CREATE INDEX "EcomTaskComment_companyId_idx" ON "EcomTaskComment"("companyId");

-- CreateIndex
CREATE INDEX "EcommerceDailyEntry_companyId_idx" ON "EcommerceDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "EcommerceListingLine_companyId_idx" ON "EcommerceListingLine"("companyId");

-- CreateIndex
CREATE INDEX "EcommerceTask_companyId_idx" ON "EcommerceTask"("companyId");

-- CreateIndex
CREATE INDEX "EntryAttachment_companyId_idx" ON "EntryAttachment"("companyId");

-- CreateIndex
CREATE INDEX "Feedback_companyId_idx" ON "Feedback"("companyId");

-- CreateIndex
CREATE INDEX "FeedbackReply_companyId_idx" ON "FeedbackReply"("companyId");

-- CreateIndex
CREATE INDEX "Holiday_companyId_idx" ON "Holiday"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");

-- CreateIndex
CREATE INDEX "InventoryItem_companyId_idx" ON "InventoryItem"("companyId");

-- CreateIndex
CREATE INDEX "InventoryMovement_companyId_idx" ON "InventoryMovement"("companyId");

-- CreateIndex
CREATE INDEX "ItadDailyEntry_companyId_idx" ON "ItadDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "LeadGenBreakdown_companyId_idx" ON "LeadGenBreakdown"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadGenBreakdown_companyId_month_category_key" ON "LeadGenBreakdown"("companyId", "month", "category");

-- CreateIndex
CREATE INDEX "LeadGenDailyEntry_companyId_idx" ON "LeadGenDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "LeadGenVerticalCount_companyId_idx" ON "LeadGenVerticalCount"("companyId");

-- CreateIndex
CREATE INDEX "LeaveDay_companyId_idx" ON "LeaveDay"("companyId");

-- CreateIndex
CREATE INDEX "LoginEvent_companyId_idx" ON "LoginEvent"("companyId");

-- CreateIndex
CREATE INDEX "MarketingPlan_companyId_idx" ON "MarketingPlan"("companyId");

-- CreateIndex
CREATE INDEX "MarketingPlanItem_companyId_idx" ON "MarketingPlanItem"("companyId");

-- CreateIndex
CREATE INDEX "MarketingTask_companyId_idx" ON "MarketingTask"("companyId");

-- CreateIndex
CREATE INDEX "MarketingTaskComment_companyId_idx" ON "MarketingTaskComment"("companyId");

-- CreateIndex
CREATE INDEX "Meeting_companyId_idx" ON "Meeting"("companyId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_companyId_idx" ON "MeetingAttendee"("companyId");

-- CreateIndex
CREATE INDEX "MeetingNote_companyId_idx" ON "MeetingNote"("companyId");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "OfficeNetwork_companyId_idx" ON "OfficeNetwork"("companyId");

-- CreateIndex
CREATE INDEX "PmActivity_companyId_idx" ON "PmActivity"("companyId");

-- CreateIndex
CREATE INDEX "PmAttachment_companyId_idx" ON "PmAttachment"("companyId");

-- CreateIndex
CREATE INDEX "PmChecklistItem_companyId_idx" ON "PmChecklistItem"("companyId");

-- CreateIndex
CREATE INDEX "PmColumn_companyId_idx" ON "PmColumn"("companyId");

-- CreateIndex
CREATE INDEX "PmComment_companyId_idx" ON "PmComment"("companyId");

-- CreateIndex
CREATE INDEX "PmDispatchLog_companyId_idx" ON "PmDispatchLog"("companyId");

-- CreateIndex
CREATE INDEX "PmExtensionRequest_companyId_idx" ON "PmExtensionRequest"("companyId");

-- CreateIndex
CREATE INDEX "PmLabel_companyId_idx" ON "PmLabel"("companyId");

-- CreateIndex
CREATE INDEX "PmNotifyPref_companyId_idx" ON "PmNotifyPref"("companyId");

-- CreateIndex
CREATE INDEX "PmProject_companyId_idx" ON "PmProject"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PmProject_companyId_name_key" ON "PmProject"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PmProject_companyId_key_key" ON "PmProject"("companyId", "key");

-- CreateIndex
CREATE INDEX "PmProjectMember_companyId_idx" ON "PmProjectMember"("companyId");

-- CreateIndex
CREATE INDEX "PmReview_companyId_idx" ON "PmReview"("companyId");

-- CreateIndex
CREATE INDEX "PmTask_companyId_idx" ON "PmTask"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PmTask_companyId_code_key" ON "PmTask"("companyId", "code");

-- CreateIndex
CREATE INDEX "PmTaskAssignee_companyId_idx" ON "PmTaskAssignee"("companyId");

-- CreateIndex
CREATE INDEX "PmTaskLabel_companyId_idx" ON "PmTaskLabel"("companyId");

-- CreateIndex
CREATE INDEX "PmTaskWatcher_companyId_idx" ON "PmTaskWatcher"("companyId");

-- CreateIndex
CREATE INDEX "PushSubscription_companyId_idx" ON "PushSubscription"("companyId");

-- CreateIndex
CREATE INDEX "QaAnswer_companyId_idx" ON "QaAnswer"("companyId");

-- CreateIndex
CREATE INDEX "QaCategory_companyId_idx" ON "QaCategory"("companyId");

-- CreateIndex
CREATE INDEX "QaEvaluation_companyId_idx" ON "QaEvaluation"("companyId");

-- CreateIndex
CREATE INDEX "QaEvaluationCategory_companyId_idx" ON "QaEvaluationCategory"("companyId");

-- CreateIndex
CREATE INDEX "QaQuestion_companyId_idx" ON "QaQuestion"("companyId");

-- CreateIndex
CREATE INDEX "QaScorecard_companyId_idx" ON "QaScorecard"("companyId");

-- CreateIndex
CREATE INDEX "Rdp_companyId_idx" ON "Rdp"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Rdp_companyId_provider_address_key" ON "Rdp"("companyId", "provider", "address");

-- CreateIndex
CREATE INDEX "RdpAssignment_companyId_idx" ON "RdpAssignment"("companyId");

-- CreateIndex
CREATE INDEX "SalaryRecord_companyId_idx" ON "SalaryRecord"("companyId");

-- CreateIndex
CREATE INDEX "SavedDoc_companyId_idx" ON "SavedDoc"("companyId");

-- CreateIndex
CREATE INDEX "SearchTermPage_companyId_idx" ON "SearchTermPage"("companyId");

-- CreateIndex
CREATE INDEX "SentMonthlyReport_companyId_idx" ON "SentMonthlyReport"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SentMonthlyReport_companyId_month_department_key" ON "SentMonthlyReport"("companyId", "month", "department");

-- CreateIndex
CREATE INDEX "SeoDailyEntry_companyId_idx" ON "SeoDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "SocialDailyEntry_companyId_idx" ON "SocialDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "SocialPlatformCount_companyId_idx" ON "SocialPlatformCount"("companyId");

-- CreateIndex
CREATE INDEX "StockRequest_companyId_idx" ON "StockRequest"("companyId");

-- CreateIndex
CREATE INDEX "SubDepartment_companyId_idx" ON "SubDepartment"("companyId");

-- CreateIndex
CREATE INDEX "SupportMessage_companyId_idx" ON "SupportMessage"("companyId");

-- CreateIndex
CREATE INDEX "Tag_companyId_idx" ON "Tag"("companyId");

-- CreateIndex
CREATE INDEX "TalkloopCountryCount_companyId_idx" ON "TalkloopCountryCount"("companyId");

-- CreateIndex
CREATE INDEX "TalkloopDailyEntry_companyId_idx" ON "TalkloopDailyEntry"("companyId");

-- CreateIndex
CREATE INDEX "Target_companyId_idx" ON "Target"("companyId");

-- CreateIndex
CREATE INDEX "TeamMemberEvent_companyId_idx" ON "TeamMemberEvent"("companyId");

-- CreateIndex
CREATE INDEX "TodoItem_companyId_idx" ON "TodoItem"("companyId");

-- CreateIndex
CREATE INDEX "UserDepartment_companyId_idx" ON "UserDepartment"("companyId");

-- CreateIndex
CREATE INDEX "WfhRequest_companyId_idx" ON "WfhRequest"("companyId");

-- CreateIndex
CREATE INDEX "WorkLogEntry_companyId_idx" ON "WorkLogEntry"("companyId");

-- CreateIndex
CREATE INDEX "WorkLogNote_companyId_idx" ON "WorkLogNote"("companyId");

-- CreateIndex
CREATE INDEX "WorkLogReview_companyId_idx" ON "WorkLogReview"("companyId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubDepartment" ADD CONSTRAINT "SubDepartment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryAttachment" ADD CONSTRAINT "EntryAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItadDailyEntry" ADD CONSTRAINT "ItadDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenDailyEntry" ADD CONSTRAINT "LeadGenDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenVerticalCount" ADD CONSTRAINT "LeadGenVerticalCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalkloopDailyEntry" ADD CONSTRAINT "TalkloopDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalkloopCountryCount" ADD CONSTRAINT "TalkloopCountryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberEvent" ADD CONSTRAINT "TeamMemberEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRecord" ADD CONSTRAINT "SalaryRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeNetwork" ADD CONSTRAINT "OfficeNetwork_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedCheckIn" ADD CONSTRAINT "BlockedCheckIn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceReminder" ADD CONSTRAINT "AttendanceReminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceViolation" ADD CONSTRAINT "AttendanceViolation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakEntry" ADD CONSTRAINT "BreakEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceShift" ADD CONSTRAINT "AttendanceShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rdp" ADD CONSTRAINT "Rdp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RdpAssignment" ADD CONSTRAINT "RdpAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoDailyEntry" ADD CONSTRAINT "SeoDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDailyEntry" ADD CONSTRAINT "ContentDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialDailyEntry" ADD CONSTRAINT "SocialDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPlatformCount" ADD CONSTRAINT "SocialPlatformCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentMonthlyReport" ADD CONSTRAINT "SentMonthlyReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTaskComment" ADD CONSTRAINT "MarketingTaskComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTermPage" ADD CONSTRAINT "SearchTermPage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSuite" ADD CONSTRAINT "BusinessSuite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSocialMonthly" ADD CONSTRAINT "BrandSocialMonthly_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSeoDaily" ADD CONSTRAINT "BrandSeoDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanItem" ADD CONSTRAINT "MarketingPlanItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReply" ADD CONSTRAINT "FeedbackReply_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaScorecard" ADD CONSTRAINT "QaScorecard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCategory" ADD CONSTRAINT "QaCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaQuestion" ADD CONSTRAINT "QaQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluation" ADD CONSTRAINT "QaEvaluation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvaluationCategory" ADD CONSTRAINT "QaEvaluationCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaAnswer" ADD CONSTRAINT "QaAnswer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenBreakdown" ADD CONSTRAINT "LeadGenBreakdown_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceDailyEntry" ADD CONSTRAINT "EcommerceDailyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceListingLine" ADD CONSTRAINT "EcommerceListingLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceTask" ADD CONSTRAINT "EcommerceTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcomTaskComment" ADD CONSTRAINT "EcomTaskComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmProject" ADD CONSTRAINT "PmProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmProjectMember" ADD CONSTRAINT "PmProjectMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmColumn" ADD CONSTRAINT "PmColumn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTask" ADD CONSTRAINT "PmTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskAssignee" ADD CONSTRAINT "PmTaskAssignee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskWatcher" ADD CONSTRAINT "PmTaskWatcher_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmLabel" ADD CONSTRAINT "PmLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskLabel" ADD CONSTRAINT "PmTaskLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmChecklistItem" ADD CONSTRAINT "PmChecklistItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmReview" ADD CONSTRAINT "PmReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmComment" ADD CONSTRAINT "PmComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmAttachment" ADD CONSTRAINT "PmAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmActivity" ADD CONSTRAINT "PmActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmExtensionRequest" ADD CONSTRAINT "PmExtensionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmDispatchLog" ADD CONSTRAINT "PmDispatchLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmNotifyPref" ADD CONSTRAINT "PmNotifyPref_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatCall" ADD CONSTRAINT "ChatCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscriptLine" ADD CONSTRAINT "CallTranscriptLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReaction" ADD CONSTRAINT "ChatReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedDoc" ADD CONSTRAINT "SavedDoc_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WfhRequest" ADD CONSTRAINT "WfhRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerLead" ADD CONSTRAINT "DialerLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerImport" ADD CONSTRAINT "DialerImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerStatusChange" ADD CONSTRAINT "DialerStatusChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerAction" ADD CONSTRAINT "DialerAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerNote" ADD CONSTRAINT "DialerNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerUserPrefs" ADD CONSTRAINT "DialerUserPrefs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerIntegration" ADD CONSTRAINT "DialerIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerCall" ADD CONSTRAINT "DialerCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerSettings" ADD CONSTRAINT "DialerSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogEntry" ADD CONSTRAINT "WorkLogEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogNote" ADD CONSTRAINT "WorkLogNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogReview" ADD CONSTRAINT "WorkLogReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeKey" ADD CONSTRAINT "ClaudeKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 99 Technologies (company 1) can never be deleted, whatever the app or a script asks.
CREATE OR REPLACE FUNCTION metriq_keep_company_1() RETURNS trigger AS $$
BEGIN
  IF OLD."id" = 'company-1' THEN
    RAISE EXCEPTION 'Company 1 (99 Technologies) cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Company_keep_company_1" BEFORE DELETE ON "Company"
  FOR EACH ROW EXECUTE FUNCTION metriq_keep_company_1();
