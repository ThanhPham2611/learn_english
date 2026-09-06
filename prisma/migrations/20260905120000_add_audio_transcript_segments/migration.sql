-- AlterTable
-- Nullable nên không cần default, không đụng dữ liệu cũ. Cache cũ
-- (segmentsJson NULL) được route transcribe coi như cache miss.
ALTER TABLE "AudioTranscript" ADD COLUMN     "segmentsJson" TEXT;
