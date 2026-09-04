CREATE TABLE "tax_return_reconciliation_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_return_id" uuid NOT NULL,
	"suggestion_id" text NOT NULL,
	"dismissed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_return_reconciliation_dismissals_uniq" UNIQUE("tax_return_id","suggestion_id")
);
--> statement-breakpoint
ALTER TABLE "tax_return_reconciliation_dismissals" ADD CONSTRAINT "tax_return_reconciliation_dismissals_tax_return_id_tax_returns_id_fk" FOREIGN KEY ("tax_return_id") REFERENCES "public"."tax_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_return_reconciliation_dismissals_return_idx" ON "tax_return_reconciliation_dismissals" USING btree ("tax_return_id");