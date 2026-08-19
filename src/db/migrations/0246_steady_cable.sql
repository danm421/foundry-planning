CREATE TABLE "portal_calculator_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"calculator_key" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_calculator_states_client_key_uniq" UNIQUE("client_id","calculator_key")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_calculators_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_calculator_states" ADD CONSTRAINT "portal_calculator_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;