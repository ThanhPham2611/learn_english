-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "overallLevel" TEXT NOT NULL DEFAULT 'A2',
    "listening" TEXT,
    "reading" TEXT,
    "writing" TEXT,
    "speaking" TEXT,
    "placementDone" BOOLEAN NOT NULL DEFAULT false,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastStudyDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skill" TEXT NOT NULL,
    "cefr" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Attempt_skill_createdAt_idx" ON "Attempt"("skill", "createdAt");
