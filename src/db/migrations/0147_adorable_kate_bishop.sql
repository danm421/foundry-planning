CREATE TYPE "public"."hsa_coverage" AS ENUM('self', 'family');--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'hsa' BEFORE 'trust';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "hsa_coverage" "hsa_coverage";