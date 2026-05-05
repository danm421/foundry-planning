CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"template_key" text,
	"pages" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_client_id_idx" ON "reports" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "reports_firm_id_idx" ON "reports" USING btree ("firm_id");