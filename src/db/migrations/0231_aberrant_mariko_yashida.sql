CREATE TABLE "advisor_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"advisor_user_id" text NOT NULL,
	"eligible" boolean NOT NULL,
	"started_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "advisor_onboarding_firm_advisor_uq" ON "advisor_onboarding" USING btree ("firm_id","advisor_user_id");