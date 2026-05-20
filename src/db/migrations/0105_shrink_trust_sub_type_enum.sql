ALTER TABLE "entities" ALTER COLUMN "trust_sub_type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "entities" SET "trust_sub_type" = 'irrevocable' WHERE "trust_sub_type" IN ('slat','crt','grat','qprt','clat','qtip','bypass');--> statement-breakpoint
DROP TYPE "public"."trust_sub_type";--> statement-breakpoint
CREATE TYPE "public"."trust_sub_type" AS ENUM('revocable', 'irrevocable', 'ilit', 'clut');--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "trust_sub_type" SET DATA TYPE "public"."trust_sub_type" USING "trust_sub_type"::"public"."trust_sub_type";