CREATE TABLE "advisor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"advisor_user_id" text NOT NULL,
	"branding_enabled" boolean DEFAULT false NOT NULL,
	"brand_name" text,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"address" text,
	"email_from_name" text,
	"email_reply_to" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "book_silo_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "advisor_profiles_firm_advisor_uq" ON "advisor_profiles" USING btree ("firm_id","advisor_user_id");