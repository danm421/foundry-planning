DROP INDEX "plan_story_chapters_client_scenario_chapter_idx";--> statement-breakpoint
ALTER TABLE "plan_story_chapters" ADD COLUMN "document_role" text DEFAULT 'standalone' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_story_chapters_client_scenario_role_chapter_idx" ON "plan_story_chapters" USING btree ("client_id","scenario_id","document_role","chapter_id");