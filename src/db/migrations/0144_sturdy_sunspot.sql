ALTER TABLE "crm_households" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_households" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "crm_households_firm_deleted_idx" ON "crm_households" USING btree ("firm_id","deleted_at");