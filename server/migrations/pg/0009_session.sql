-- Persistent session store for express-session via connect-pg-simple.
--
-- PostgreSQL only: local development uses the in-memory store, so there is no
-- SQLite counterpart to this migration. This is the standard connect-pg-simple
-- schema (sid primary key, JSON payload, expiry index). `IF NOT EXISTS` keeps it
-- safe to re-run and harmless if the table was ever created by hand.
CREATE TABLE IF NOT EXISTS "session" (
	"sid" varchar NOT NULL COLLATE "default",
	"sess" json NOT NULL,
	"expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION
	WHEN invalid_table_definition THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
