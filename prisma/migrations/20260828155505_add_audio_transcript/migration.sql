-- CreateTable
CREATE TABLE "AudioTranscript" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudioTranscript_userId_idx" ON "AudioTranscript"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTranscript_userId_fileHash_key" ON "AudioTranscript"("userId", "fileHash");
