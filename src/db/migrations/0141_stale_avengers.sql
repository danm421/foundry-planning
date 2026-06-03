CREATE TABLE "reinvestment_groups" (
	"reinvestment_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reinvestment_groups_reinvestment_id_group_key_pk" PRIMARY KEY("reinvestment_id","group_key")
);
--> statement-breakpoint
ALTER TABLE "reinvestment_groups" ADD CONSTRAINT "reinvestment_groups_reinvestment_id_reinvestments_id_fk" FOREIGN KEY ("reinvestment_id") REFERENCES "public"."reinvestments"("id") ON DELETE cascade ON UPDATE no action;