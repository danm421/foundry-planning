CREATE TABLE "client_comparison_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_comparison_layouts_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "client_comparison_layouts" ADD CONSTRAINT "client_comparison_layouts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_comparison_layouts_client_idx" ON "client_comparison_layouts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_comparison_layouts_firm_idx" ON "client_comparison_layouts" USING btree ("firm_id");