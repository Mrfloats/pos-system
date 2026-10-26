#!/bin/sh
# Runs once, when the production database is first created (docker-compose.prod.yml).
#
# Same two roles as development (see init.sql), but with the passwords from .env:
#   pos_owner  owns the tables and runs migrations (not subject to row-level security)
#   pos_app    is what the running API connects as; every query is filtered by row-level security
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$POS_OWNER_PASSWORD" -v app_pw="$POS_APP_PASSWORD" <<'SQL'
CREATE ROLE pos_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE pos_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE pos OWNER pos_owner;
GRANT CONNECT ON DATABASE pos TO pos_app;
SQL
