-- Privileges for the API's runtime role (pos_app).
-- pos_app is not a table owner, so every row it reads or writes passes through
-- the row-level security policies created in 0000_init.sql.
GRANT USAGE ON SCHEMA public TO pos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;--> statement-breakpoint
-- Tables created by later migrations (run as pos_owner) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;--> statement-breakpoint
-- Ledgers are append-only: the API can add rows but never change or remove them.
REVOKE UPDATE, DELETE ON stock_movements FROM pos_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;
