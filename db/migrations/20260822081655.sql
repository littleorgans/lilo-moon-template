-- Create "accounts" table
CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workos_org_id" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("id"), CONSTRAINT "accounts_workos_org_id_key" UNIQUE ("workos_org_id"));
-- Create "profiles" table
CREATE TABLE "profiles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workos_user_id" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("id"), CONSTRAINT "profiles_workos_user_id_key" UNIQUE ("workos_user_id"));
