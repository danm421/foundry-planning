-- pgvector must exist before the vector(1536) column below. drizzle-kit does
-- not emit CREATE EXTENSION, so this statement is hand-added (plan Task 4).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."kb_source" AS ENUM('planning_playbook', 'tax_reference', 'client_document', 'firm_note', 'other');--> statement-breakpoint
CREATE TABLE "planning_kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "kb_source" NOT NULL,
	"source_ref" text NOT NULL,
	"firm_id" text,
	"client_id" uuid,
	"chunk_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planning_kb_chunks" ADD CONSTRAINT "planning_kb_chunks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planning_kb_chunks_content_hash_uq" ON "planning_kb_chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "planning_kb_chunks_firm_id_idx" ON "planning_kb_chunks" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "planning_kb_chunks_client_id_idx" ON "planning_kb_chunks" USING btree ("client_id");--> statement-breakpoint
-- ANN index for cosine-distance KB retrieval (embedding <=> query). Hand-added:
-- drizzle-kit can't express HNSW. IVFFlat fallback if HNSW is unavailable on the
-- Neon compute (confirmed at apply-time):
--   CREATE INDEX ... ON "planning_kb_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS "planning_kb_chunks_embedding_hnsw"
	ON "planning_kb_chunks" USING hnsw ("embedding" vector_cosine_ops);