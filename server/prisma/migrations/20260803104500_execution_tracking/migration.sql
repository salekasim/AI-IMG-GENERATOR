-- AlterTable
ALTER TABLE "WorkflowExecution" ADD COLUMN     "attempts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "modelUsed" TEXT,
ADD COLUMN     "providerUsed" TEXT;
