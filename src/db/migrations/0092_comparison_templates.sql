CREATE TYPE "public"."comparison_template_visibility" AS ENUM('private', 'firm');--> statement-breakpoint
CREATE TABLE "client_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"layout" jsonb NOT NULL,
	"source_template_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "comparison_template_visibility" DEFAULT 'private' NOT NULL,
	"slot_count" integer NOT NULL,
	"slot_labels" jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_comparisons" ADD CONSTRAINT "client_comparisons_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_comparisons_client_idx" ON "client_comparisons" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_comparisons_firm_idx" ON "client_comparisons" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "client_comparisons_source_idx" ON "client_comparisons" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "comparison_templates_firm_idx" ON "comparison_templates" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "comparison_templates_creator_idx" ON "comparison_templates" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "client_comparisons" ADD CONSTRAINT "client_comparisons_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "public"."comparison_templates"("id") ON DELETE SET NULL ON UPDATE no action;