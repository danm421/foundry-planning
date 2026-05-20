CREATE TABLE "note_extra_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_receivable_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"type" "extra_payment_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_receivable_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_receivable_id" uuid NOT NULL,
	"family_member_id" uuid,
	"entity_id" uuid,
	"external_beneficiary_id" uuid,
	"percent" numeric(6, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "note_receivable_owners_uniq" UNIQUE NULLS NOT DISTINCT("note_receivable_id","family_member_id","entity_id","external_beneficiary_id"),
	CONSTRAINT "note_receivable_owners_one_owner" CHECK (("note_receivable_owners"."family_member_id" IS NOT NULL)::int
        + ("note_receivable_owners"."entity_id" IS NOT NULL)::int
        + ("note_receivable_owners"."external_beneficiary_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "notes_receivable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"face_value" numeric(15, 2) NOT NULL,
	"basis" numeric(15, 2) NOT NULL,
	"as_of_balance" numeric(15, 2),
	"balance_as_of_month" integer,
	"balance_as_of_year" integer,
	"interest_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"payment_type" "note_payment_type" NOT NULL,
	"monthly_payment" numeric(15, 2),
	"start_year" integer NOT NULL,
	"start_month" integer DEFAULT 1 NOT NULL,
	"start_year_ref" "year_ref",
	"term_months" integer NOT NULL,
	"linked_trust_entity_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_extra_payments" ADD CONSTRAINT "note_extra_payments_note_receivable_id_notes_receivable_id_fk" FOREIGN KEY ("note_receivable_id") REFERENCES "public"."notes_receivable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_receivable_owners" ADD CONSTRAINT "note_receivable_owners_note_receivable_id_notes_receivable_id_fk" FOREIGN KEY ("note_receivable_id") REFERENCES "public"."notes_receivable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_receivable_owners" ADD CONSTRAINT "note_receivable_owners_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_receivable_owners" ADD CONSTRAINT "note_receivable_owners_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_receivable_owners" ADD CONSTRAINT "note_receivable_owners_external_beneficiary_id_external_beneficiaries_id_fk" FOREIGN KEY ("external_beneficiary_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_receivable" ADD CONSTRAINT "notes_receivable_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_receivable" ADD CONSTRAINT "notes_receivable_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_receivable" ADD CONSTRAINT "notes_receivable_linked_trust_entity_id_entities_id_fk" FOREIGN KEY ("linked_trust_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;