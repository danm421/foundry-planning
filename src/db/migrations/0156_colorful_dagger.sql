CREATE TABLE "solver_mc_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"success_rate" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solver_mc_cache" ADD CONSTRAINT "solver_mc_cache_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solver_mc_cache" ADD CONSTRAINT "solver_mc_cache_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "solver_mc_cache_client_hash_idx" ON "solver_mc_cache" USING btree ("client_id","input_hash");--> statement-breakpoint
CREATE INDEX "solver_mc_cache_computed_at_idx" ON "solver_mc_cache" USING btree ("computed_at");