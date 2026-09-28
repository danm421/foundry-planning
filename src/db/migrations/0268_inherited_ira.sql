ALTER TABLE "accounts" ADD COLUMN "inherited_death_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "inherited_owner_birth_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "inherited_heir_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_inherited_fields_paired" CHECK (("accounts"."inherited_death_year" IS NULL) = ("accounts"."inherited_owner_birth_year" IS NULL));