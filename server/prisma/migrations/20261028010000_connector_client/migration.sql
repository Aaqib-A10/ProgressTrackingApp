-- Connectors: which app a key was made for (Claude, ChatGPT, Gemini). Existing keys were all made for Claude.
ALTER TABLE "ClaudeKey" ADD COLUMN "client" TEXT NOT NULL DEFAULT 'claude';
