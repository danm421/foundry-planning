ALTER TYPE "public"."family_relationship" ADD VALUE 'stepchild' BEFORE 'grandchild';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'great_grandchild' BEFORE 'parent';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'grandparent' BEFORE 'sibling';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'sibling_in_law' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'child_in_law' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'niece_nephew' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'aunt_uncle' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'cousin' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'grand_aunt_uncle' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "domestic_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "inheritance_class_override" jsonb DEFAULT '{}'::jsonb NOT NULL;