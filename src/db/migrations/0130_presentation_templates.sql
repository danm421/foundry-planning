CREATE TABLE "presentation_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"name" text NOT NULL,
	"pages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presentation_templates_firm_visibility_idx" ON "presentation_templates" USING btree ("firm_id","visibility");--> statement-breakpoint
CREATE INDEX "presentation_templates_firm_creator_idx" ON "presentation_templates" USING btree ("firm_id","created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_templates_unique_name_per_creator_visibility_idx" ON "presentation_templates" USING btree ("firm_id","visibility","created_by_user_id","name");