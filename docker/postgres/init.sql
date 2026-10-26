-- Runs once, when the Postgres container is first created.
--
-- Two roles keep tenant isolation enforced by the database itself:
--   pos_owner  owns the tables and runs migrations (not subject to row-level security)
--   pos_app    is what the running API connects as; every query it makes is filtered
--              by the row-level security policies created in the migrations.
-- Change these passwords for any shared or production environment.

CREATE ROLE pos_owner LOGIN PASSWORD 'pos_owner' CREATEDB;
CREATE ROLE pos_app LOGIN PASSWORD 'pos_app';

CREATE DATABASE pos OWNER pos_owner;
GRANT CONNECT ON DATABASE pos TO pos_app;

-- Separate database for automated tests
CREATE DATABASE pos_test OWNER pos_owner;
GRANT CONNECT ON DATABASE pos_test TO pos_app;
