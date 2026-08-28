-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MistakeRecord" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "correction" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MistakeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MistakeRecord_userId_category_createdAt_idx" ON "MistakeRecord"("userId", "category", "createdAt");
