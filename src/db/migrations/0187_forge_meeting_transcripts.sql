CREATE TABLE "forge_meeting_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"conversation_id" text,
	"raw_text" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'paste' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge_meeting_transcripts" ADD CONSTRAINT "forge_meeting_transcripts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_meeting_transcripts" ADD CONSTRAINT "forge_meeting_transcripts_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forge_meeting_transcripts_client_idx" ON "forge_meeting_transcripts" USING btree ("client_id","created_at");