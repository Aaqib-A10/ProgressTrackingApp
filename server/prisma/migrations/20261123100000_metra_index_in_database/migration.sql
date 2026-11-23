-- Metra's search inside the database (METRA_INDEX=database): each piece's vector as numbers, and an index for
-- Postgres's own word search over the piece. Nothing changes while METRA_INDEX is not set.
ALTER TABLE "AiChunk" ADD COLUMN "vec" REAL[] DEFAULT ARRAY[]::REAL[];
CREATE INDEX "AiChunk_words_idx" ON "AiChunk" USING GIN (to_tsvector('simple', "title" || ' ' || "text"));
