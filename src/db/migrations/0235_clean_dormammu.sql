ALTER TABLE "client_insight_profiles" ADD COLUMN "headline" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_insight_profiles" ADD COLUMN "actions" jsonb;--> statement-breakpoint
ALTER TABLE "client_insight_profiles" ADD COLUMN "talking_points" jsonb;