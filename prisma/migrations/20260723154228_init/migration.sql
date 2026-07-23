-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "overallLevel" TEXT NOT NULL DEFAULT 'A2',
    "listening" TEXT,
    "reading" TEXT,
    "writing" TEXT,
    "speaking" TEXT,
    "placementDone" BOOLEAN NOT NULL DEFAULT false,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "dailyGoal" INTEGER NOT NULL DEFAULT 3,
    "lastStudyDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" SERIAL NOT NULL,
    "skill" TEXT NOT NULL,
    "cefr" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabCard" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "example" TEXT,
    "level" TEXT NOT NULL,
    "sourceSkill" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attempt_skill_createdAt_idx" ON "Attempt"("skill", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabCard_word_key" ON "VocabCard"("word");

-- CreateIndex
CREATE INDEX "VocabCard_dueDate_idx" ON "VocabCard"("dueDate");
