ALTER TYPE "public"."account_category" ADD VALUE 'education_savings';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "grantor_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "grantor_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "beneficiary_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "beneficiary_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "roth_rollover_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "roth_rollover_start_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "roth_rollover_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_grantor_family_member_id_family_members_id_fk" FOREIGN KEY ("grantor_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_beneficiary_family_member_id_family_members_id_fk" FOREIGN KEY ("beneficiary_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_roth_rollover_account_id_accounts_id_fk" FOREIGN KEY ("roth_rollover_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;