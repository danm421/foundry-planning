CREATE TYPE "public"."titling_type" AS ENUM('jtwros', 'community_property');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "titling_type" "titling_type" DEFAULT 'jtwros' NOT NULL;