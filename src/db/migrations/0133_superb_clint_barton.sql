CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier_type" varchar(16) NOT NULL,
	"identifier" text NOT NULL,
	"figi" text,
	"name" text,
	"security_type" varchar(16) DEFAULT 'other' NOT NULL,
	"classifier_source" varchar(16) DEFAULT 'eodhd' NOT NULL,
	"classifier_version" integer DEFAULT 1 NOT NULL,
	"raw_payload" jsonb,
	"classified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_asset_class_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"asset_class_slug" varchar(50) NOT NULL,
	"weight" numeric(5, 4) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_asset_class_weights" ADD CONSTRAINT "security_asset_class_weights_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "securities_identifier_uniq" ON "securities" USING btree ("identifier_type","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "security_acw_uniq" ON "security_asset_class_weights" USING btree ("security_id","asset_class_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_classes_firm_slug_uniq" ON "asset_classes" USING btree ("firm_id","slug") WHERE "asset_classes"."slug" IS NOT NULL;