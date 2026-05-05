CREATE TABLE "will_residuary_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"will_id" uuid NOT NULL,
	"recipient_kind" "will_recipient_kind" NOT NULL,
	"recipient_id" uuid,
	"percentage" numeric(5, 2) NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "will_residuary_recipients" ADD CONSTRAINT "will_residuary_recipients_will_id_wills_id_fk" FOREIGN KEY ("will_id") REFERENCES "public"."wills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "will_residuary_recipients_will_sort_idx" ON "will_residuary_recipients" USING btree ("will_id","sort_order");