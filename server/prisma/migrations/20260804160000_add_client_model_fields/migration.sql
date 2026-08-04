-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN "clientEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "clientModelName" TEXT;