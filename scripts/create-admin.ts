/**
 * إنشاء حساب المدير التنفيذي الأول بصورة آمنة.
 *
 * الاستخدام:
 *   npm run create-admin -- --email ed@example.org --name "عبدالملك الدريهم"
 *
 * - يقرأ NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY من البيئة (.env.local).
 * - يطلب كلمة المرور من الطرفية دون إظهارها (أو من ADMIN_PASSWORD إن وُجد).
 * - يرفض الإنشاء إذا وُجد مدير تنفيذي نشط مسبقًا (إلا مع --force).
 * - الدور يكتب في app_metadata التي لا يستطيع المستخدم تعديلها بنفسه.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function askHidden(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // إخفاء الإدخال
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted) out.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('عرّف NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env.local');
  const email = arg('email');
  const name = arg('name') ?? 'المدير التنفيذي';
  if (!email) throw new Error('حدد البريد: --email');

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existing, error: exErr } = await admin.from('profiles').select('id,email').eq('role', 'executive_director').eq('is_active', true);
  if (exErr) throw new Error('تعذر الاتصال بقاعدة البيانات: ' + exErr.message + ' — هل طبقت الترحيلات؟');
  if (existing && existing.length && !process.argv.includes('--force')) {
    throw new Error(`يوجد مدير تنفيذي نشط (${existing.map((e) => e.email).join(', ')}). استخدم --force لإضافة آخر.`);
  }

  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    password = await askHidden('كلمة المرور (12 حرفًا على الأقل): ');
    const again = await askHidden('أعد كتابة كلمة المرور: ');
    if (password !== again) throw new Error('كلمتا المرور غير متطابقتين');
  }
  if (password.length < 12) throw new Error('كلمة المرور قصيرة: 12 حرفًا على الأقل');

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
    app_metadata: { role: 'executive_director' },
  });
  if (error) throw new Error('فشل إنشاء الحساب: ' + error.message);
  const { error: pErr } = await admin.from('profiles').update({ role: 'executive_director', full_name: name, job_title: 'المدير التنفيذي' }).eq('id', data.user!.id);
  if (pErr) throw new Error('أنشئ الحساب لكن تعذر ضبط الدور: ' + pErr.message);
  console.log(`✓ أنشئ حساب المدير التنفيذي: ${email}`);
  console.log('  سجّل الدخول الآن، ثم أضف بقية المستخدمين من «الإعدادات ← المستخدمون».');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
