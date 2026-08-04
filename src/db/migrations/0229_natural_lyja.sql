CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"date_digest_cadence" text DEFAULT 'weekly' NOT NULL,
	"email_prompt_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"actor_user_id" text,
	"client_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"url" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"dedup_key" text,
	"in_app" boolean NOT NULL,
	"email_pending" boolean NOT NULL,
	"emailed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_first_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "intake_forms" ADD COLUMN "opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_firm_user_idx" ON "notification_preferences" USING btree ("firm_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_pending";--> statement-breakpoint
CREATE INDEX "notifications_firm_idx" ON "notifications" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedup_idx" ON "notifications" USING btree ("user_id","dedup_key") WHERE "notifications"."dedup_key" is not null;