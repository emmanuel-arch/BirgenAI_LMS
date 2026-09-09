-- Conversation tables. Idempotent: safe to re-run.

DO $$ BEGIN
  CREATE TYPE "ThreadKind" AS ENUM ('APPLICATION','KYC_REVIEW','LOAN','REPAYMENT','GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ThreadState" AS ENUM ('AWAITING_STAFF','AWAITING_CUSTOMER','RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ConversationThread" (
  "id"                TEXT NOT NULL,
  "orgId"             TEXT NOT NULL,
  "borrowerId"        TEXT NOT NULL,
  "kind"              "ThreadKind"  NOT NULL DEFAULT 'GENERAL',
  "state"             "ThreadState" NOT NULL DEFAULT 'AWAITING_STAFF',
  "subject"           TEXT NOT NULL,
  "applicationId"     TEXT,
  "loanId"            TEXT,
  "stageTitle"        TEXT,
  "assignedStaffId"   TEXT,
  "assignedStaffName" TEXT,
  "lastAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPreview"       TEXT,
  "lastAuthorType"    TEXT,
  "unreadForStaff"    INTEGER NOT NULL DEFAULT 0,
  "unreadForBorrower" INTEGER NOT NULL DEFAULT 0,
  "closedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConversationMessage" (
  "id"               TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "threadId"         TEXT NOT NULL,
  "authorType"       TEXT NOT NULL,
  "authorId"         TEXT,
  "authorName"       TEXT NOT NULL,
  "body"             TEXT NOT NULL,
  "attachments"      JSONB NOT NULL DEFAULT '[]',
  "event"            TEXT,
  "eventData"        JSONB,
  "readByStaffAt"    TIMESTAMP(3),
  "readByBorrowerAt" TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConversationThread_orgId_state_lastAt_idx"
  ON "ConversationThread" ("orgId", "state", "lastAt");
CREATE INDEX IF NOT EXISTS "ConversationThread_orgId_borrowerId_lastAt_idx"
  ON "ConversationThread" ("orgId", "borrowerId", "lastAt");
CREATE INDEX IF NOT EXISTS "ConversationThread_orgId_applicationId_idx"
  ON "ConversationThread" ("orgId", "applicationId");
CREATE INDEX IF NOT EXISTS "ConversationThread_orgId_assignedStaffId_state_idx"
  ON "ConversationThread" ("orgId", "assignedStaffId", "state");
CREATE INDEX IF NOT EXISTS "ConversationMessage_orgId_threadId_createdAt_idx"
  ON "ConversationMessage" ("orgId", "threadId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ConversationThread" ADD CONSTRAINT "ConversationThread_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationThread" ADD CONSTRAINT "ConversationThread_borrowerId_fkey"
    FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "ConversationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
