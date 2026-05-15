CREATE TYPE "public"."distribution_form" AS ENUM('in_trust', 'outright');--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD COLUMN "distribution_form" "distribution_form";
--> statement-breakpoint
UPDATE "beneficiary_designations" SET "distribution_form" = 'outright' WHERE "tier" = 'remainder';