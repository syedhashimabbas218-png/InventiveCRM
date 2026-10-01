#!/bin/sh
set -eu
# Fail closed on migrations; the upstream entrypoint logs upgrade failures and continues.
if [ "${DISABLE_DB_MIGRATIONS:-false}" != "true" ]; then
    has_schema=$(psql "$PG_DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core')")
    if [ "$has_schema" = "f" ]; then
        yarn database:init:prod
    fi
    yarn command:prod cache:flush
    yarn command:prod upgrade
    yarn command:prod cache:flush
fi
if [ "${DISABLE_CRON_JOBS_REGISTRATION:-false}" != "true" ]; then
    yarn command:prod cron:register:all
fi
exec "$@"
