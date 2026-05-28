CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_members" (
	"account_group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_members_account_group_id_account_id_pk" PRIMARY KEY("account_group_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_account_group_id_account_groups_id_fk" FOREIGN KEY ("account_group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_groups_client_idx" ON "account_groups" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_client_name_unique" ON "account_groups" USING btree ("client_id",LOWER("name"));--> statement-breakpoint
CREATE INDEX "account_group_members_account_idx" ON "account_group_members" USING btree ("account_id");