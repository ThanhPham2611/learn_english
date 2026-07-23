-- CreateTable
CREATE TABLE "VocabCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "word" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "example" TEXT,
    "level" TEXT NOT NULL,
    "sourceSkill" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "VocabCard_word_key" ON "VocabCard"("word");

-- CreateIndex
CREATE INDEX "VocabCard_dueDate_idx" ON "VocabCard"("dueDate");
