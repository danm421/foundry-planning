CREATE TABLE "ops_entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"mode" text NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_entitlement_overrides_mode_check" CHECK ("ops_entitlement_overrides"."mode" IN ('grant','revoke'))
);
--> statement-breakpoint
CREATE INDEX "ops_entitlement_overrides_firm_idx" ON "ops_entitlement_overrides" USING btree ("firm_id","entitlement");