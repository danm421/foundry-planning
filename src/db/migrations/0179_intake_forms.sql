CREATE TYPE "public"."intake_mode" AS ENUM('blank', 'prefilled');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('draft', 'submitted', 'applied', 'discarded', 'expired');--> statement-breakpoint
CREATE TABLE "intake_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid,
	"mode" "intake_mode" NOT NULL,
	"status" "intake_status" DEFAULT 'draft' NOT NULL,
	"token" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"sent_at" timestamp,
	"submitted_at" timestamp,
	"applied_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_forms_token_idx" ON "intake_forms" USING btree ("token");--> statement-breakpoint
CREATE INDEX "intake_forms_firm_idx" ON "intake_forms" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "intake_forms_client_idx" ON "intake_forms" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "intake_forms_status_idx" ON "intake_forms" USING btree ("status");