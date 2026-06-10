CREATE TABLE "clerk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"svix_id" text NOT NULL,
	"event_type" text NOT NULL,
	"result" text,
	"processed_at" timestamp with time zone,
	"processing_duration_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clerk_events_svix_id_unique" UNIQUE("svix_id")
);
--> statement-breakpoint
CREATE INDEX "clerk_events_created_idx" ON "clerk_events" USING btree ("created_at");