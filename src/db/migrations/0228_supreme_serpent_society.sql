CREATE TYPE "public"."dependent_override" AS ENUM('auto', 'yes', 'no');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "covered_by_workplace_plan" "dependent_override" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "spouse_covered_by_workplace_plan" "dependent_override" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "claimed_as_dependent" "dependent_override" DEFAULT 'auto' NOT NULL;