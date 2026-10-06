ALTER TABLE "advisor_onboarding" ADD COLUMN "welcome_video_seen_at" timestamp with time zone;--> statement-breakpoint
-- Advisors already on Foundry never get the welcome video: only rows created
-- after this migration start NULL.
UPDATE "advisor_onboarding" SET "welcome_video_seen_at" = now();
