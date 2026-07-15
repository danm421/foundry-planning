CREATE TABLE "user_solver_report_layout" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
