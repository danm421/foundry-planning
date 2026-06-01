CREATE TABLE "crm_household_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_household_views" ADD CONSTRAINT "crm_household_views_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_household_views_user_household_uq" ON "crm_household_views" USING btree ("user_id","household_id");--> statement-breakpoint
CREATE INDEX "crm_household_views_firm_user_opened_idx" ON "crm_household_views" USING btree ("firm_id","user_id","opened_at" DESC NULLS LAST);