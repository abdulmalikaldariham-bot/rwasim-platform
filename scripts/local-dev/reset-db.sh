#!/usr/bin/env bash
# إعادة تهيئة قاعدة بيانات محلية (بيئة دون Docker) وتطبيق الترحيلات بالترتيب.
# الاستخدام: PGURL=postgresql://postgres:postgres@127.0.0.1:5432/rawasim ./scripts/local-dev/reset-db.sh
set -euo pipefail
PGURL=${PGURL:-postgresql://postgres:postgres@127.0.0.1:5432/rawasim}
DIR=$(cd "$(dirname "$0")/../.." && pwd)
PGOPTIONS="-c client_min_messages=warning" psql "$PGURL" -q -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
delete from storage.objects;
delete from storage.buckets;
delete from auth.users;
grant usage on schema storage to anon, authenticated, service_role;
-- صلاحيات التخزين كما في Supabase المستضاف (البيئة المحلية دون Docker لا تضبطها تلقائيًا)
grant all on all tables in schema storage to anon, authenticated, service_role;
grant all on all sequences in schema storage to anon, authenticated, service_role;
SQL
for f in "$DIR"/supabase/migrations/*.sql; do
  PGOPTIONS="-c client_min_messages=warning" psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done
psql "$PGURL" -q -c "notify pgrst, 'reload schema';"
echo "تمت إعادة التهيئة"
