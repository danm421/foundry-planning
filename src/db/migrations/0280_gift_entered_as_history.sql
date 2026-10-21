ALTER TABLE "gifts" ADD COLUMN "entered_as_history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: until now a gift was folded into the stored owners at save exactly
-- when its year preceded the plan start, and no start year has ever moved, so
-- "dated before the year it was created (US Eastern)" is that set.
UPDATE "gifts" SET "entered_as_history" = true WHERE "year" < EXTRACT(YEAR FROM ("created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York');
