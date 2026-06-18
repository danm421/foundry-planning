CREATE TABLE "client_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"recipient_email" text NOT NULL,
	"scope" text NOT NULL,
	"client_id" uuid,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_shares_recipient_idx" ON "client_shares" USING btree ("recipient_user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "client_shares_owner_idx" ON "client_shares" USING btree ("firm_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_shares_active_all_idx" ON "client_shares" USING btree ("owner_user_id","recipient_user_id") WHERE "client_shares"."scope" = 'all' AND "client_shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_shares_active_client_idx" ON "client_shares" USING btree ("client_id","recipient_user_id") WHERE "client_shares"."scope" = 'client' AND "client_shares"."revoked_at" IS NULL;