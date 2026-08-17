ALTER TABLE "plan_story_chapters" ADD COLUMN "generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "plan_story_chapters" ADD COLUMN "generated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "plan_story_chapters" ADD COLUMN "edited_at" timestamp;