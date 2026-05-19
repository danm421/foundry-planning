CREATE TABLE "life_insurance_solver_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"death_year" integer NOT NULL,
	"li_growth_rate" numeric(5, 4) NOT NULL,
	"leave_to_heirs_amount" numeric(15, 2) NOT NULL,
	"final_expenses" numeric(15, 2) NOT NULL,
	"living_expense_at_death" numeric(15, 2),
	"pay_off_debts_at_death" boolean DEFAULT false NOT NULL,
	"mc_target_score" numeric(5, 4) DEFAULT '0.9' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "life_insurance_solver_settings_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" ADD CONSTRAINT "life_insurance_solver_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;