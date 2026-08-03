-- AlterTable
ALTER TABLE "AiProvider" DROP COLUMN IF EXISTS "models",
ADD COLUMN     "chatEndpoint" TEXT,
ADD COLUMN     "cooldownMs" INTEGER NOT NULL DEFAULT 30000,
ADD COLUMN     "costPer1kIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "costPer1kOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "dailyQuota" INTEGER,
ADD COLUMN     "embeddingEndpoint" TEXT,
ADD COLUMN     "failureStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "headers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "icon" TEXT NOT NULL DEFAULT '⚡',
ADD COLUMN     "imageEndpoint" TEXT,
ADD COLUMN     "lastHealthCheck" TIMESTAMP(3),
ADD COLUMN     "maxContext" INTEGER,
ADD COLUMN     "maxOutput" INTEGER,
ADD COLUMN     "maxRpm" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "maxTpm" INTEGER NOT NULL DEFAULT 100000,
ADD COLUMN     "monthlyQuota" INTEGER,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "queryParams" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "speechEndpoint" TEXT,
ADD COLUMN     "supportsAudio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsFunctionCalling" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsImages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsJsonMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsVision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visionEndpoint" TEXT,
ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "costPer1kIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPer1kOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxTokens" INTEGER,
    "temperatureLimit" DOUBLE PRECISION DEFAULT 2,
    "supportsImages" BOOLEAN NOT NULL DEFAULT false,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsAudio" BOOLEAN NOT NULL DEFAULT false,
    "supportsToolCalls" BOOLEAN NOT NULL DEFAULT true,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "supportsJson" BOOLEAN NOT NULL DEFAULT true,
    "supportsFunctionCalling" BOOLEAN NOT NULL DEFAULT true,
    "supportsReasoning" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingVariable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingVariable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingVariableRoute" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingVariableRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "condition" JSONB,
    "action" TEXT NOT NULL,
    "targetProviderId" TEXT,
    "targetModelId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiModel_enabled_hidden_idx" ON "AiModel"("enabled", "hidden");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_providerId_internalName_key" ON "AiModel"("providerId", "internalName");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingVariable_name_key" ON "RoutingVariable"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingVariableRoute_variableId_modelId_key" ON "RoutingVariableRoute"("variableId", "modelId");

-- AddForeignKey
ALTER TABLE "AiModel" ADD CONSTRAINT "AiModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingVariableRoute" ADD CONSTRAINT "RoutingVariableRoute_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "RoutingVariable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingVariableRoute" ADD CONSTRAINT "RoutingVariableRoute_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_targetProviderId_fkey" FOREIGN KEY ("targetProviderId") REFERENCES "AiProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_targetModelId_fkey" FOREIGN KEY ("targetModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
