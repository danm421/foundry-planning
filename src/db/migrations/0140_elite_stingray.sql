CREATE TABLE "cma_set_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cma_set_id" uuid NOT NULL,
	"asset_class_id" uuid NOT NULL,
	"geometric_return" numeric(7, 4) NOT NULL,
	"arithmetic_mean" numeric(7, 4) NOT NULL,
	"volatility" numeric(7, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cma_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"key" varchar(16) NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cma_sets_firm_key_unique" UNIQUE("firm_id","key")
);
--> statement-breakpoint
ALTER TABLE "cma_set_values" ADD CONSTRAINT "cma_set_values_cma_set_id_cma_sets_id_fk" FOREIGN KEY ("cma_set_id") REFERENCES "public"."cma_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_set_values" ADD CONSTRAINT "cma_set_values_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cma_set_values_set_class_uniq" ON "cma_set_values" USING btree ("cma_set_id","asset_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cma_sets_one_active_per_firm" ON "cma_sets" USING btree ("firm_id") WHERE "cma_sets"."is_active";