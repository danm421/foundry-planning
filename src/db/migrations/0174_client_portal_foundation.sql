ALTER TABLE "audit_log" ADD COLUMN "actor_kind" text DEFAULT 'advisor' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_invited_at" timestamp;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_edit_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_clerk_user_id_unique" UNIQUE("clerk_user_id");