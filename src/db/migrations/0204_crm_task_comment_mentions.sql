CREATE TABLE "crm_task_comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_task_comment_mentions" ADD CONSTRAINT "crm_task_comment_mentions_comment_id_crm_task_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."crm_task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_comment_mentions" ADD CONSTRAINT "crm_task_comment_mentions_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_task_comment_mentions_feed_idx" ON "crm_task_comment_mentions" USING btree ("firm_id","mentioned_user_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_task_comment_mentions_comment_idx" ON "crm_task_comment_mentions" USING btree ("comment_id");