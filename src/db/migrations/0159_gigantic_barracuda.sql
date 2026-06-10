CREATE TABLE "staff_advisor_visibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"staff_user_id" text NOT NULL,
	"advisor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE INDEX "staff_advisor_visibility_firm_staff_idx" ON "staff_advisor_visibility" USING btree ("firm_id","staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_advisor_visibility_unique_edge" ON "staff_advisor_visibility" USING btree ("firm_id","staff_user_id","advisor_user_id");