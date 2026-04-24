CREATE TYPE "public"."trust_sub_type" AS ENUM('revocable', 'irrevocable', 'ilit', 'slat', 'crt', 'grat', 'qprt', 'clat', 'qtip', 'bypass');--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "trust_sub_type" "trust_sub_type";--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "is_irrevocable" boolean;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "trustee" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "exemption_consumed" numeric(15, 2) DEFAULT '0' NOT NULL;