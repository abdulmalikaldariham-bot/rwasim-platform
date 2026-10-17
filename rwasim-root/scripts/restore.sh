#!/usr/bin/env bash
# استعادة نسخة احتياطية إلى قاعدة بيانات (يفضل مشروع Supabase جديد أو بيئة اختبار أولًا)
# الاستخدام: SUPABASE_DB_URL=... npm run restore -- backups/rawasim-YYYYMMDD-HHMMSS.dump
set -euo pipefail
: "${SUPABASE_DB_URL:?عرّف SUPABASE_DB_URL}"
FILE=${1:?حدد ملف النسخة}
read -r -p "سيتم استبدال بيانات المخطط public في القاعدة الهدف. اكتب «استعادة» للمتابعة: " ok
[ "$ok" = "استعادة" ] || { echo "أُلغيت"; exit 1; }
pg_restore --dbname="$SUPABASE_DB_URL" --no-owner --no-privileges --clean --if-exists "$FILE"
echo "✓ تمت الاستعادة. شغّل: notify pgrst, 'reload schema'; من محرر SQL إن لزم."
