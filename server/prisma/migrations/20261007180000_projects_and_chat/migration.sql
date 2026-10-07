-- CreateEnum
CREATE TYPE "PmProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PmProjectRole" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PmColumnCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "PmExtensionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChatConversationType" AS ENUM ('DIRECT', 'GROUP', 'PROJECT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TASK_UNASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'EXTENSION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'EXTENSION_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_MEMBER_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'CHAT_MESSAGE';

-- CreateTable
CREATE TABLE "PmProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#4F46E5',
    "status" "PmProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "taskCounter" INTEGER NOT NULL DEFAULT 0,
    "overdueNotifyAdmins" BOOLEAN NOT NULL DEFAULT true,
    "overdueRepeatHours" INTEGER NOT NULL DEFAULT 24,
    "reminderOffsetsMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PmProjectRole" NOT NULL DEFAULT 'MEMBER',
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmColumn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PmColumnCategory" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "wipLimit" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "columnId" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "createdById" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimateHours" DOUBLE PRECISION,
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "overdueSince" TIMESTAMP(3),
    "lastOverdueNotifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmTaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTaskWatcher" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PmTaskWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748B',

    CONSTRAINT "PmLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTaskLabel" (
    "taskId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "PmTaskLabel_pkey" PRIMARY KEY ("taskId","labelId")
);

-- CreateTable
CREATE TABLE "PmChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmActivity" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmExtensionRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "currentDueAt" TIMESTAMP(3),
    "requestedDueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PmExtensionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmExtensionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmDispatchLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueAtSnapshot" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmDispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmNotifyPref" (
    "userId" TEXT NOT NULL,
    "emailAssigned" BOOLEAN NOT NULL DEFAULT true,
    "emailMention" BOOLEAN NOT NULL DEFAULT true,
    "emailComment" BOOLEAN NOT NULL DEFAULT false,
    "emailDueSoon" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmNotifyPref_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "type" "ChatConversationType" NOT NULL,
    "projectId" TEXT,
    "name" TEXT,
    "directKey" TEXT,
    "createdById" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "replyToId" TEXT,
    "taskRefId" TEXT,
    "fileStoredName" TEXT,
    "fileName" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PmProject_name_key" ON "PmProject"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PmProject_key_key" ON "PmProject"("key");

-- CreateIndex
CREATE INDEX "PmProject_status_idx" ON "PmProject"("status");

-- CreateIndex
CREATE INDEX "PmProjectMember_userId_idx" ON "PmProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PmProjectMember_projectId_userId_key" ON "PmProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "PmColumn_projectId_position_idx" ON "PmColumn"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PmTask_code_key" ON "PmTask"("code");

-- CreateIndex
CREATE INDEX "PmTask_projectId_columnId_position_idx" ON "PmTask"("projectId", "columnId", "position");

-- CreateIndex
CREATE INDEX "PmTask_dueAt_idx" ON "PmTask"("dueAt");

-- CreateIndex
CREATE INDEX "PmTask_isOverdue_idx" ON "PmTask"("isOverdue");

-- CreateIndex
CREATE INDEX "PmTask_createdById_idx" ON "PmTask"("createdById");

-- CreateIndex
CREATE INDEX "PmTaskAssignee_userId_idx" ON "PmTaskAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PmTaskAssignee_taskId_userId_key" ON "PmTaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE INDEX "PmTaskWatcher_userId_idx" ON "PmTaskWatcher"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PmTaskWatcher_taskId_userId_key" ON "PmTaskWatcher"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PmLabel_projectId_name_key" ON "PmLabel"("projectId", "name");

-- CreateIndex
CREATE INDEX "PmChecklistItem_taskId_idx" ON "PmChecklistItem"("taskId");

-- CreateIndex
CREATE INDEX "PmComment_taskId_createdAt_idx" ON "PmComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PmAttachment_taskId_idx" ON "PmAttachment"("taskId");

-- CreateIndex
CREATE INDEX "PmActivity_taskId_createdAt_idx" ON "PmActivity"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PmExtensionRequest_taskId_status_idx" ON "PmExtensionRequest"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PmDispatchLog_taskId_userId_kind_dueAtSnapshot_key" ON "PmDispatchLog"("taskId", "userId", "kind", "dueAtSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_projectId_key" ON "ChatConversation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_directKey_key" ON "ChatConversation"("directKey");

-- CreateIndex
CREATE INDEX "ChatConversation_lastMessageAt_idx" ON "ChatConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_conversationId_userId_key" ON "ChatMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_seq_idx" ON "ChatMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_seq_key" ON "ChatMessage"("seq");

-- AddForeignKey
ALTER TABLE "PmProject" ADD CONSTRAINT "PmProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmProjectMember" ADD CONSTRAINT "PmProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmProjectMember" ADD CONSTRAINT "PmProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmColumn" ADD CONSTRAINT "PmColumn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTask" ADD CONSTRAINT "PmTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTask" ADD CONSTRAINT "PmTask_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "PmColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTask" ADD CONSTRAINT "PmTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskAssignee" ADD CONSTRAINT "PmTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskAssignee" ADD CONSTRAINT "PmTaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskWatcher" ADD CONSTRAINT "PmTaskWatcher_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskWatcher" ADD CONSTRAINT "PmTaskWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmLabel" ADD CONSTRAINT "PmLabel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskLabel" ADD CONSTRAINT "PmTaskLabel_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskLabel" ADD CONSTRAINT "PmTaskLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "PmLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmChecklistItem" ADD CONSTRAINT "PmChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmComment" ADD CONSTRAINT "PmComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmComment" ADD CONSTRAINT "PmComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmAttachment" ADD CONSTRAINT "PmAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmAttachment" ADD CONSTRAINT "PmAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmActivity" ADD CONSTRAINT "PmActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmActivity" ADD CONSTRAINT "PmActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmExtensionRequest" ADD CONSTRAINT "PmExtensionRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmExtensionRequest" ADD CONSTRAINT "PmExtensionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmExtensionRequest" ADD CONSTRAINT "PmExtensionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmDispatchLog" ADD CONSTRAINT "PmDispatchLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmNotifyPref" ADD CONSTRAINT "PmNotifyPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_taskRefId_fkey" FOREIGN KEY ("taskRefId") REFERENCES "PmTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

