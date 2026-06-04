CREATE TABLE "scenario_compute_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"input_hash" text NOT NULL,
	"trials" integer NOT NULL,
	"engine_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"compute_ms" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenario_compute_cache" ADD CONSTRAINT "scenario_compute_cache_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_compute_cache" ADD CONSTRAINT "scenario_compute_cache_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_compute_cache" ADD CONSTRAINT "scenario_compute_cache_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_compute_cache_scenario_kind_idx" ON "scenario_compute_cache" USING btree ("scenario_id","kind");--> statement-breakpoint
CREATE INDEX "scenario_compute_cache_client_idx" ON "scenario_compute_cache" USING btree ("client_id");