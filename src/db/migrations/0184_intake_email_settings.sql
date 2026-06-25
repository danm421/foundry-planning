CREATE TABLE "intake_email_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"from_name" text,
	"subject" text,
	"intro_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_email_settings" ADD CONSTRAINT "intake_email_settings_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_email_settings_firm_user_idx" ON "intake_email_settings" USING btree ("firm_id","user_id");