CREATE TABLE "ops_admins" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_admins_role_check" CHECK ("ops_admins"."role" IN ('support','ops','superadmin'))
);
