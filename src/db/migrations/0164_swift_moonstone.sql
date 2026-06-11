CREATE TABLE "builtin_template_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"builtin_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builtin_template_dismissals" ADD CONSTRAINT "builtin_template_dismissals_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builtin_template_dismissals_unique_idx" ON "builtin_template_dismissals" USING btree ("firm_id","user_id","builtin_slug");--> statement-breakpoint
CREATE INDEX "builtin_template_dismissals_firm_user_idx" ON "builtin_template_dismissals" USING btree ("firm_id","user_id");