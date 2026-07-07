CREATE TABLE "portal_privacy_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"share_transactions" boolean DEFAULT true NOT NULL,
	"share_budgets" boolean DEFAULT true NOT NULL,
	"share_recurrings" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_privacy_settings_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "portal_privacy_settings" ADD CONSTRAINT "portal_privacy_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;