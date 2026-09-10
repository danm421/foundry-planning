CREATE TABLE "portal_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_bindings" ADD CONSTRAINT "portal_bindings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_bindings_live_idx" ON "portal_bindings" USING btree ("client_id","clerk_user_id") WHERE status IN ('pending', 'active');--> statement-breakpoint
CREATE INDEX "portal_bindings_user_idx" ON "portal_bindings" USING btree ("clerk_user_id","status");--> statement-breakpoint
CREATE INDEX "portal_bindings_client_idx" ON "portal_bindings" USING btree ("client_id","status");--> statement-breakpoint
INSERT INTO "portal_bindings" ("client_id", "clerk_user_id", "status", "accepted_at", "created_at")
SELECT "id", "clerk_user_id", 'active', now(), now()
FROM "clients"
WHERE "clerk_user_id" IS NOT NULL;
