CREATE TABLE "plaid_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plaid_item_id" text,
	"webhook_type" text NOT NULL,
	"webhook_code" text NOT NULL,
	"environment" text,
	"result" text,
	"error_message" text,
	"processing_duration_ms" integer,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "new_accounts_available_at" timestamp;--> statement-breakpoint
CREATE INDEX "plaid_webhook_events_item_idx" ON "plaid_webhook_events" USING btree ("plaid_item_id");