ALTER TABLE "copilot_conversations" RENAME TO "forge_conversations";--> statement-breakpoint
ALTER INDEX "copilot_conversations_user_updated_idx" RENAME TO "forge_conversations_user_updated_idx";--> statement-breakpoint
ALTER INDEX "copilot_conversations_pkey" RENAME TO "forge_conversations_pkey";