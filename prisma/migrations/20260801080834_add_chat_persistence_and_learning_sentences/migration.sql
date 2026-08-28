-- CreateTable
CREATE TABLE "ChatSession" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'chat',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),
    "suggestionsJson" TEXT,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSentence" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "suggested" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_reviewed',
    "sentenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSentence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_userId_startedAt_idx" ON "ChatSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningSentence_userId_status_idx" ON "LearningSentence"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSentence_userId_sentenceHash_key" ON "LearningSentence"("userId", "sentenceHash");
