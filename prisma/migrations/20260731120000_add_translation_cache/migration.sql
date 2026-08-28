-- AlterTable
ALTER TABLE "VocabCard" ADD COLUMN     "pronunciation" TEXT;

-- CreateTable
CREATE TABLE "TranslationCache" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "example" TEXT,
    "pronunciation" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationCache_word_idx" ON "TranslationCache"("word");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationCache_word_contextHash_key" ON "TranslationCache"("word", "contextHash");
