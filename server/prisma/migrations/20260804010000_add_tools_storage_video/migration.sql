-- AlterTable
ALTER TABLE "AiModel" ADD COLUMN     "supportsVideo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AiProvider" ADD COLUMN     "supportsVideo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'AI',
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT '🧰',
    "color" TEXT NOT NULL DEFAULT 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    "capability" TEXT NOT NULL DEFAULT 'image',
    "requiresInput" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paramSchema" JSONB NOT NULL DEFAULT '{}',
    "defaultBinding" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageAsset" (
    "id" TEXT NOT NULL,
    "executionId" TEXT,
    "workflowId" TEXT,
    "nodeId" TEXT,
    "tool" TEXT NOT NULL DEFAULT 'image',
    "provider" TEXT,
    "model" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "mime" TEXT,
    "url" TEXT,
    "localPath" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tool_key_key" ON "Tool"("key");

-- CreateIndex
CREATE INDEX "StorageAsset_createdAt_idx" ON "StorageAsset"("createdAt");

-- CreateIndex
CREATE INDEX "StorageAsset_executionId_idx" ON "StorageAsset"("executionId");

-- AddForeignKey
ALTER TABLE "StorageAsset" ADD CONSTRAINT "StorageAsset_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
