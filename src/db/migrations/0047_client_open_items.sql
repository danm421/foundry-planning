CREATE TYPE "public"."open_item_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "client_open_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"priority" "open_item_priority" DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_open_items" ADD CONSTRAINT "client_open_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_open_items_client_completed_idx" ON "client_open_items" USING btree ("client_id","completed_at");
