CREATE TABLE "plan_story_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"generated_text" text,
	"edited_text" text,
	"source_hash" text,
	"ai_suppressed" boolean DEFAULT false NOT NULL,
	"error" text,
	"reviewed_at" timestamp,
	"reviewed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_story_chapters" ADD CONSTRAINT "plan_story_chapters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_story_chapters_client_scenario_chapter_idx" ON "plan_story_chapters" USING btree ("client_id","scenario_id","chapter_id");