#!/usr/bin/env bash
# نسخة احتياطية يدوية لقاعدة بيانات المنصة (تكمل النسخ التلقائي في Supabase)
# الاستخدام: SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres" npm run backup
set -euo pipefail
: "${SUPABASE_DB_URL:?عرّف SUPABASE_DB_URL (Project Settings → Database → Connection string → Session pooler)}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=${BACKUP_DIR:-backups}
mkdir -p "$OUT"
# البيانات المؤسسية (المخطط public) + المستخدمون (auth.users/identities) + سجلات الملفات (storage.objects)
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --format=custom \
  --schema=public --table=auth.users --table=auth.identities --table=storage.objects --table=storage.buckets \
  --file="$OUT/rawasim-$STAMP.dump"
echo "✓ $OUT/rawasim-$STAMP.dump"
echo "ملاحظة: ملفات الشواهد والتقارير نفسها محفوظة في Supabase Storage؛ لنسخها استخدم: supabase storage cp -r ss:///evidence ./backups/evidence"
