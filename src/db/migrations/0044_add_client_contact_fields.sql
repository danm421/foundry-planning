-- Fix #28: add contact info fields (email + address) for client and spouse.
-- All nullable — contact info is optional and not required for existing clients.

ALTER TABLE "clients" ADD COLUMN "email" text;
ALTER TABLE "clients" ADD COLUMN "address" text;
ALTER TABLE "clients" ADD COLUMN "spouse_email" text;
ALTER TABLE "clients" ADD COLUMN "spouse_address" text;
