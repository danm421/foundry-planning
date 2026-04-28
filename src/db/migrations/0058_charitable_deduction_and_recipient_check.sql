CREATE TYPE "public"."charity_type" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "external_beneficiaries" ADD COLUMN "charity_type" charity_type DEFAULT 'public' NOT NULL;