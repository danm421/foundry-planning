CREATE TYPE "public"."gift_event_kind" AS ENUM('outright', 'clut_remainder_interest');--> statement-breakpoint
CREATE TYPE "public"."trust_payout_type" AS ENUM('unitrust', 'annuity');--> statement-breakpoint
CREATE TYPE "public"."trust_term_type" AS ENUM('years', 'single_life', 'joint_life', 'shorter_of_years_or_life');--> statement-breakpoint
ALTER TYPE "public"."trust_sub_type" ADD VALUE 'clut' BEFORE 'qtip';--> statement-breakpoint
CREATE TABLE "trust_split_interest_details" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"inception_year" integer NOT NULL,
	"inception_value" numeric(15, 2) NOT NULL,
	"payout_type" "trust_payout_type" NOT NULL,
	"payout_percent" numeric(7, 4),
	"payout_amount" numeric(15, 2),
	"irc_7520_rate" numeric(6, 4) NOT NULL,
	"term_type" "trust_term_type" NOT NULL,
	"term_years" integer,
	"measuring_life_1_id" uuid,
	"measuring_life_2_id" uuid,
	"charity_id" uuid NOT NULL,
	"original_income_interest" numeric(15, 2) NOT NULL,
	"original_remainder_interest" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "split_interest_unitrust_payout" CHECK (("trust_split_interest_details"."payout_type" != 'unitrust') OR ("trust_split_interest_details"."payout_percent" IS NOT NULL AND "trust_split_interest_details"."payout_amount" IS NULL)),
	CONSTRAINT "split_interest_annuity_payout" CHECK (("trust_split_interest_details"."payout_type" != 'annuity') OR ("trust_split_interest_details"."payout_amount" IS NOT NULL AND "trust_split_interest_details"."payout_percent" IS NULL)),
	CONSTRAINT "split_interest_term_years_required" CHECK (("trust_split_interest_details"."term_type" NOT IN ('years', 'shorter_of_years_or_life')) OR ("trust_split_interest_details"."term_years" IS NOT NULL)),
	CONSTRAINT "split_interest_measuring_life_required" CHECK (("trust_split_interest_details"."term_type" NOT IN ('single_life', 'joint_life', 'shorter_of_years_or_life')) OR ("trust_split_interest_details"."measuring_life_1_id" IS NOT NULL)),
	CONSTRAINT "split_interest_joint_life_requires_two" CHECK (("trust_split_interest_details"."term_type" != 'joint_life') OR ("trust_split_interest_details"."measuring_life_2_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "event_kind" "gift_event_kind" DEFAULT 'outright' NOT NULL;--> statement-breakpoint
ALTER TABLE "trust_split_interest_details" ADD CONSTRAINT "trust_split_interest_details_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_split_interest_details" ADD CONSTRAINT "trust_split_interest_details_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_split_interest_details" ADD CONSTRAINT "trust_split_interest_details_measuring_life_1_id_family_members_id_fk" FOREIGN KEY ("measuring_life_1_id") REFERENCES "public"."family_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_split_interest_details" ADD CONSTRAINT "trust_split_interest_details_measuring_life_2_id_family_members_id_fk" FOREIGN KEY ("measuring_life_2_id") REFERENCES "public"."family_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_split_interest_details" ADD CONSTRAINT "trust_split_interest_details_charity_id_external_beneficiaries_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_split_interest_client_idx" ON "trust_split_interest_details" USING btree ("client_id");