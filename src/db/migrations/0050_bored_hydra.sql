CREATE TYPE "public"."scenario_op_type" AS ENUM('add', 'edit', 'remove');--> statement-breakpoint
CREATE TYPE "public"."scenario_snapshot_source_kind" AS ENUM('manual', 'pdf_export');--> statement-breakpoint
CREATE TABLE "scenario_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"op_type" "scenario_op_type" NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb,
	"toggle_group_id" uuid,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"left_scenario_id" uuid,
	"right_scenario_id" uuid,
	"effective_tree_left" jsonb NOT NULL,
	"effective_tree_right" jsonb NOT NULL,
	"toggle_state" jsonb NOT NULL,
	"raw_changes_right" jsonb NOT NULL,
	"raw_toggle_groups_right" jsonb NOT NULL,
	"frozen_at" timestamp DEFAULT now() NOT NULL,
	"frozen_by_user_id" uuid NOT NULL,
	"source_kind" "scenario_snapshot_source_kind" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_toggle_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_on" boolean DEFAULT true NOT NULL,
	"requires_group_id" uuid,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_toggle_group_id_scenario_toggle_groups_id_fk" FOREIGN KEY ("toggle_group_id") REFERENCES "public"."scenario_toggle_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_snapshots" ADD CONSTRAINT "scenario_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_toggle_groups" ADD CONSTRAINT "scenario_toggle_groups_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_changes_unique" ON "scenario_changes" USING btree ("scenario_id","target_kind","target_id","op_type");--> statement-breakpoint
ALTER TABLE "scenario_toggle_groups" ADD CONSTRAINT "scenario_toggle_groups_requires_group_id_fkey" FOREIGN KEY ("requires_group_id") REFERENCES "public"."scenario_toggle_groups"("id") ON DELETE set null ON UPDATE no action;