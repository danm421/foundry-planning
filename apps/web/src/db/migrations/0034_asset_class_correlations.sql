CREATE TABLE "asset_class_correlations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_class_id_a" uuid NOT NULL,
	"asset_class_id_b" uuid NOT NULL,
	"correlation" numeric(6, 5) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_class_correlations" ADD CONSTRAINT "asset_class_correlations_asset_class_id_a_asset_classes_id_fk" FOREIGN KEY ("asset_class_id_a") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_class_correlations" ADD CONSTRAINT "asset_class_correlations_asset_class_id_b_asset_classes_id_fk" FOREIGN KEY ("asset_class_id_b") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_class_correlations_pair_uniq" ON "asset_class_correlations" USING btree ("asset_class_id_a","asset_class_id_b");