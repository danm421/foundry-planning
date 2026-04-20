-- Treat the spouse as a co-client with their own surname. Prior schema assumed
-- the spouse shared the client's last name via a single "spouseName" text blob.
ALTER TABLE "clients" ADD COLUMN "spouse_last_name" text;
