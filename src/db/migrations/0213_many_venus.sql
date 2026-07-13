CREATE TYPE "public"."portal_notification_kind" AS ENUM('transactions_to_review', 'reconnect_required');--> statement-breakpoint
CREATE TABLE "portal_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"plaid_item_id" uuid,
	"kind" "portal_notification_kind" NOT NULL,
	"body" text NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_push_tokens_expo_push_token_unique" UNIQUE("expo_push_token")
);
--> statement-breakpoint
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_push_tokens" ADD CONSTRAINT "portal_push_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_notifications_client_kind_idx" ON "portal_notifications" USING btree ("client_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "portal_push_tokens_client_idx" ON "portal_push_tokens" USING btree ("client_id");