-- DropIndex
DROP INDEX "Attempt_skill_createdAt_idx";

-- DropIndex
DROP INDEX "VocabCard_dueDate_idx";

-- DropIndex
DROP INDEX "VocabCard_word_key";

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Profile" DROP CONSTRAINT "Profile_pkey",
DROP COLUMN "id",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId");

-- AlterTable
ALTER TABLE "VocabCard" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Attempt_userId_skill_createdAt_idx" ON "Attempt"("userId", "skill", "createdAt");

-- CreateIndex
CREATE INDEX "VocabCard_userId_dueDate_idx" ON "VocabCard"("userId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "VocabCard_userId_word_key" ON "VocabCard"("userId", "word");

