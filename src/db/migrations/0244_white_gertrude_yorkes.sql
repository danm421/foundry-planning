ALTER TABLE "stock_option_vest_tranches" ADD COLUMN "acquired_on" date;--> statement-breakpoint
ALTER TABLE "stock_option_vest_tranches" ADD COLUMN "price_at_acquisition" numeric(15, 4);