-- Create "records" table
CREATE TABLE "records" ("id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY, "value" text NOT NULL, PRIMARY KEY ("id"));
INSERT INTO "records" ("value") VALUES ('retained');
