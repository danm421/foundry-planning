ALTER TABLE "life_insurance_solver_settings" ADD COLUMN "model_portfolio_id" uuid;--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" ADD COLUMN "payoff_liability_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" ADD CONSTRAINT "life_insurance_solver_settings_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" DROP COLUMN "li_growth_rate";--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" DROP COLUMN "final_expenses";--> statement-breakpoint
ALTER TABLE "life_insurance_solver_settings" DROP COLUMN "pay_off_debts_at_death";