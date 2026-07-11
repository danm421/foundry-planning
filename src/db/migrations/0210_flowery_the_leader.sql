CREATE TABLE "client_insight_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"snapshot" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"opportunities" text DEFAULT '' NOT NULL,
	"input_hash" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"generated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_insight_profiles_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "client_insight_profiles" ADD CONSTRAINT "client_insight_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;