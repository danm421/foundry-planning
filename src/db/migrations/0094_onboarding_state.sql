ALTER TABLE "clients" ADD COLUMN "onboarding_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "onboarding_completed_at" timestamp;