ALTER TYPE "public"."trust_sub_type" ADD VALUE IF NOT EXISTS 'clt';--> statement-breakpoint
ALTER TYPE "public"."gift_event_kind" ADD VALUE IF NOT EXISTS 'clt_remainder_interest';--> statement-breakpoint

UPDATE "entities" SET "trust_sub_type" = 'clt' WHERE "trust_sub_type" = 'clut';--> statement-breakpoint
UPDATE "gifts" SET "event_kind" = 'clt_remainder_interest' WHERE "event_kind" = 'clut_remainder_interest';
