CREATE TYPE "public"."gift_amount_mode" AS ENUM('fixed', 'annual_exclusion');--> statement-breakpoint
ALTER TABLE "gift_series" ADD COLUMN "amount_mode" "gift_amount_mode" DEFAULT 'fixed' NOT NULL;