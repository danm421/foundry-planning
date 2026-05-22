ALTER TABLE "clients" ALTER COLUMN "crm_household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_crm_household_id_crm_households_id_fk" FOREIGN KEY ("crm_household_id") REFERENCES "public"."crm_households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "last_name";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "date_of_birth";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "spouse_name";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "spouse_last_name";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "spouse_dob";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "spouse_email";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "spouse_address";--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_crm_household_id_unique" UNIQUE("crm_household_id");