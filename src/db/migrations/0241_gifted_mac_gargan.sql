CREATE TABLE "story_voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"advisor_user_id" text DEFAULT '' NOT NULL,
	"style_note" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_voice_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"advisor_user_id" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"source_chapter_id" text,
	"source_client_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_voice_samples" ADD CONSTRAINT "story_voice_samples_source_client_id_clients_id_fk" FOREIGN KEY ("source_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_voice_profiles_firm_advisor_uq" ON "story_voice_profiles" USING btree ("firm_id","advisor_user_id");--> statement-breakpoint
CREATE INDEX "story_voice_samples_firm_advisor_idx" ON "story_voice_samples" USING btree ("firm_id","advisor_user_id");