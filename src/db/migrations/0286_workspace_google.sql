ALTER TYPE "public"."workspace_provider" ADD VALUE 'google';--> statement-breakpoint
DROP INDEX "ws_conn_user_uq";--> statement-breakpoint
CREATE INDEX "ws_conn_user_idx" ON "workspace_connections" USING btree ("firm_id","user_id");