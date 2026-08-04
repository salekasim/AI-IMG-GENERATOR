-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "resolution" TEXT NOT NULL DEFAULT 'medium',
    "ratio" TEXT NOT NULL DEFAULT '1:1',
    "model" TEXT,
    "provider" TEXT NOT NULL,
    "sizeW" INTEGER NOT NULL,
    "sizeH" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "images" JSONB NOT NULL DEFAULT '[]',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
