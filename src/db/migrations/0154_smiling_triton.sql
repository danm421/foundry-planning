CREATE TABLE "revocable_trusts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "revocable_trust_id" uuid;--> statement-breakpoint
ALTER TABLE "revocable_trusts" ADD CONSTRAINT "revocable_trusts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revocable_trusts_client_idx" ON "revocable_trusts" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_revocable_trust_id_revocable_trusts_id_fk" FOREIGN KEY ("revocable_trust_id") REFERENCES "public"."revocable_trusts"("id") ON DELETE set null ON UPDATE no action;