CREATE TYPE "public"."investment_proposal_status" AS ENUM('draft', 'presented', 'accepted');--> statement-breakpoint
CREATE TABLE "investment_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "investment_proposal_status" DEFAULT 'draft' NOT NULL,
	"source" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"target_label" text NOT NULL,
	"advisory_fee_current" numeric(6, 5),
	"advisory_fee_proposed" numeric(6, 5),
	"override_ltcg_rate" numeric(6, 5),
	"notes" text,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "expense_ratio" numeric(7, 6);--> statement-breakpoint
ALTER TABLE "investment_proposals" ADD CONSTRAINT "investment_proposals_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_proposals" ADD CONSTRAINT "investment_proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_proposals_client_idx" ON "investment_proposals" USING btree ("client_id","updated_at");--> statement-breakpoint
CREATE INDEX "investment_proposals_firm_idx" ON "investment_proposals" USING btree ("firm_id");