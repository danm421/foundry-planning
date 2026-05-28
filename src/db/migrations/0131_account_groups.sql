CREATE TABLE "account_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "color" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "account_groups_client_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
);

CREATE INDEX "account_groups_client_idx"
  ON "account_groups" ("client_id");

CREATE UNIQUE INDEX "account_groups_client_name_unique"
  ON "account_groups" ("client_id", LOWER("name"));

CREATE TABLE "account_group_members" (
  "account_group_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "account_group_members_pkey"
    PRIMARY KEY ("account_group_id", "account_id"),
  CONSTRAINT "account_group_members_group_fk"
    FOREIGN KEY ("account_group_id") REFERENCES "account_groups"("id") ON DELETE CASCADE,
  CONSTRAINT "account_group_members_account_fk"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE
);

CREATE INDEX "account_group_members_account_idx"
  ON "account_group_members" ("account_id");
