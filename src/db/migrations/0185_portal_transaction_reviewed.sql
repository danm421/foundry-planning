ALTER TABLE "plaid_transactions" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
UPDATE "plaid_transactions" SET "reviewed_at" = "created_at" WHERE "reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "plaid_transactions_client_reviewed_idx" ON "plaid_transactions" USING btree ("client_id","reviewed_at");
