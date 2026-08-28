-- CreateTable
CREATE TABLE "PhraseCard" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "blankWord" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhraseCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhraseCard_userId_dueDate_idx" ON "PhraseCard"("userId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PhraseCard_userId_phrase_key" ON "PhraseCard"("userId", "phrase");
