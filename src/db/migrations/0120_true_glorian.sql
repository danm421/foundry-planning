CREATE TYPE "public"."crm_task_activity_kind" AS ENUM('created', 'status_changed', 'priority_changed', 'assignee_changed', 'household_changed', 'due_date_changed', 'start_date_changed', 'title_changed', 'description_changed', 'recurrence_changed', 'tags_changed', 'file_uploaded', 'file_deleted', 'completed', 'reopened', 'comment_posted');--> statement-breakpoint
CREATE TYPE "public"."crm_task_priority" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."crm_task_recurrence" AS ENUM('none', 'weekly', 'monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."crm_task_status" AS ENUM('open', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TABLE "crm_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_task_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" "crm_task_activity_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body_markdown" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_task_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "crm_task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "crm_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "crm_task_priority" DEFAULT 'med' NOT NULL,
	"status" "crm_task_status" DEFAULT 'open' NOT NULL,
	"due_date" date,
	"start_date" date,
	"recurrence" "crm_task_recurrence" DEFAULT 'none' NOT NULL,
	"household_id" uuid,
	"assignee_user_id" text,
	"created_by_user_id" text NOT NULL,
	"completed_by_user_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_task_activity" ADD CONSTRAINT "crm_task_activity_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_comments" ADD CONSTRAINT "crm_task_comments_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_files" ADD CONSTRAINT "crm_task_files_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_tags" ADD CONSTRAINT "crm_task_tags_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_tags" ADD CONSTRAINT "crm_task_tags_tag_id_crm_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."crm_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_tags_firm_label_idx" ON "crm_tags" USING btree ("firm_id","label");--> statement-breakpoint
CREATE INDEX "crm_task_activity_task_created_idx" ON "crm_task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_task_comments_task_created_idx" ON "crm_task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_task_files_task_idx" ON "crm_task_files" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "crm_tasks_firm_status_idx" ON "crm_tasks" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "crm_tasks_household_idx" ON "crm_tasks" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "crm_tasks_assignee_idx" ON "crm_tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "crm_tasks_firm_due_idx" ON "crm_tasks" USING btree ("firm_id","due_date");