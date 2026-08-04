-- Phase 1: Workflow engine architecture
-- 1) Tool → Capability rename + capability metadata columns
-- 2) New registry entities: ProviderCredential, ModelCapability, ModelRoute,
--    NodeDefinition, StorageProvider
-- 3) Versioning: WorkflowVersion + Workflow.draftGraph/status
-- 4) Traceability: ExecutionStep, ErrorLog, WorkflowExecution.cancelRequestedAt,
--    StorageAsset.storageProviderId

-- ── Tool → Capability ────────────────────────────────────────────────────
ALTER TABLE "Tool" RENAME TO "Capability";
ALTER INDEX "Tool_pkey" RENAME TO "Capability_pkey";
ALTER INDEX "Tool_key_key" RENAME TO "Capability_key_key";

ALTER TABLE "Capability" RENAME COLUMN "defaultBinding" TO "defaultChain";

ALTER TABLE "Capability"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'capability',
  ADD COLUMN "inputPorts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "outputPorts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "defaults" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "hasRuntime" BOOLEAN NOT NULL DEFAULT true;

-- ── AiProvider / AiModel ─────────────────────────────────────────────────
-- (no columns added; relations via new tables below)

-- ── StorageAsset ─────────────────────────────────────────────────────────
ALTER TABLE "StorageAsset"
  ADD COLUMN "storageProviderId" TEXT;
CREATE INDEX "StorageAsset_storageProviderId_idx" ON "StorageAsset"("storageProviderId");

-- ── Workflow versioning ──────────────────────────────────────────────────
ALTER TABLE "Workflow"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN "draftGraph" JSONB;

CREATE TABLE "WorkflowVersion" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "graph" JSONB NOT NULL,
  "note" TEXT,
  "createdBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── WorkflowExecution ────────────────────────────────────────────────────
ALTER TABLE "WorkflowExecution"
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);

-- ── ProviderCredential ───────────────────────────────────────────────────
CREATE TABLE "ProviderCredential" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "apiKeyEnc" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "failureStreak" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderCredential_providerId_enabled_priority_idx" ON "ProviderCredential"("providerId", "enabled", "priority");
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ModelCapability ──────────────────────────────────────────────────────
CREATE TABLE "ModelCapability" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "supported" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModelCapability_modelId_capabilityKey_key" ON "ModelCapability"("modelId", "capabilityKey");
CREATE INDEX "ModelCapability_capabilityKey_idx" ON "ModelCapability"("capabilityKey");
ALTER TABLE "ModelCapability" ADD CONSTRAINT "ModelCapability_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ModelRoute ───────────────────────────────────────────────────────────
CREATE TABLE "ModelRoute" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "retryPolicy" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelRoute_pkey" PRIMARY KEY ("id")
);

-- ── NodeDefinition ───────────────────────────────────────────────────────
CREATE TABLE "NodeDefinition" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'logic',
  "category" TEXT NOT NULL DEFAULT 'Logic',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT NOT NULL DEFAULT '🧩',
  "color" TEXT NOT NULL DEFAULT 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  "inputPorts" JSONB NOT NULL DEFAULT '[]',
  "outputPorts" JSONB NOT NULL DEFAULT '[]',
  "paramSchema" JSONB NOT NULL DEFAULT '{}',
  "defaults" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodeDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NodeDefinition_key_key" ON "NodeDefinition"("key");

-- ── StorageProvider ──────────────────────────────────────────────────────
CREATE TABLE "StorageProvider" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "driver" TEXT NOT NULL DEFAULT 'local',
  "configEnc" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorageProvider_pkey" PRIMARY KEY ("id")
);

-- ── ExecutionStep ────────────────────────────────────────────────────────
CREATE TABLE "ExecutionStep" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeType" TEXT NOT NULL,
  "nodeName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" JSONB NOT NULL DEFAULT '[]',
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "outputRefs" JSONB NOT NULL DEFAULT '[]',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExecutionStep_executionId_nodeId_idx" ON "ExecutionStep"("executionId", "nodeId");
ALTER TABLE "ExecutionStep" ADD CONSTRAINT "ExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ErrorLog ─────────────────────────────────────────────────────────────
CREATE TABLE "ErrorLog" (
  "id" TEXT NOT NULL,
  "executionId" TEXT,
  "nodeId" TEXT,
  "nodeType" TEXT,
  "source" TEXT NOT NULL DEFAULT 'engine',
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
CREATE INDEX "ErrorLog_executionId_idx" ON "ErrorLog"("executionId");
