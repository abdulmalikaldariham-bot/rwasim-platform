'use server';
import { revalidatePath } from 'next/cache';
import { randomBytes, randomInt } from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import type { ActionResult } from './steps';

const fail = (m: string): { ok: false; error: string } => ({ ok: false, error: m });

async function caller() {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data: p } = await sb.from('profiles').select('id,role,is_active').eq('id', u.user.id).single();
  if (!p?.is_active) return null;
  return { sb, id: u.user.id, role: p.role as string };
}

// ---------- السنوات ----------
export async function createYearAction(year: number, transitional: boolean): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (!(year >= 2020 && year <= 2100)) return fail('سنة غير صالحة');
  const { error } = await c.sb.rpc('create_year', { p_year: year, p_transitional: transitional, p_notes: null });
  if (error) return fail(error.code === '23505' ? 'السنة موجودة مسبقًا' : error.message);
  revalidatePath('/', 'layout');
  return { ok: true, message: `أُنشئت سنة ${year}م بحدود أسابيعها وأوزان إداراتها` };
}

export async function archiveYearAction(year: number): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  const { error } = await c.sb.rpc('archive_year', { p_year: year });
  if (error) return fail(error.message);
  revalidatePath('/', 'layout');
  return { ok: true, message: `أُرشفت سنة ${year}م` };
}

export async function updateWeekAction(year: number, quarter: number, weekIndex: number, start: string, end: string): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (end < start) return fail('تاريخ النهاية قبل البداية');
  const { data, error } = await c.sb.from('quarter_weeks').update({ start_date: start, end_date: end, is_reviewed: true }).eq('year', year).eq('quarter', quarter).eq('week_index', weekIndex).select('week_index');
  if (error) return fail(error.message);
  if (!data?.length) return fail('تعديل حدود الأسابيع من صلاحية المدير التنفيذي');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُدثت حدود الأسبوع' };
}

export async function markWeeksReviewedAction(year: number, quarter: number): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  const { error } = await c.sb.from('quarter_weeks').update({ is_reviewed: true }).eq('year', year).eq('quarter', quarter);
  if (error) return fail(error.message);
  revalidatePath('/settings');
  return { ok: true, message: 'اعتُمدت حدود أسابيع الربع' };
}

// ---------- الإدارات ----------
export async function upsertDepartmentAction(input: { id?: string; name: string; short_name?: string; code?: string }): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (!input.name.trim()) return fail('اكتب اسم الإدارة');
  if (input.id) {
    const { error } = await c.sb.from('departments').update({ name: input.name.trim(), short_name: input.short_name?.trim() || null }).eq('id', input.id);
    if (error) return fail(error.message);
  } else {
    const { data: max } = await c.sb.from('departments').select('sort_order').order('sort_order', { ascending: false }).limit(1);
    const code = (input.code?.trim() || 'D' + Date.now().toString(36)).toUpperCase().slice(0, 12);
    const { error } = await c.sb.from('departments').insert({ name: input.name.trim(), short_name: input.short_name?.trim() || null, code, sort_order: (max?.[0]?.sort_order ?? 0) + 1 });
    if (error) return fail(error.code === '23505' ? 'الاسم أو الرمز مستخدم' : error.message.includes('row-level') ? 'إدارة الهيكل من صلاحية المدير التنفيذي' : error.message);
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُفظت الإدارة. راجع أوزان الإدارات للسنة الحالية.' };
}

export async function toggleDepartmentAction(id: string, active: boolean): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  const { error } = await c.sb.from('departments').update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() }).eq('id', id);
  if (error) return fail(error.message);
  revalidatePath('/', 'layout');
  return { ok: true, message: active ? 'فُعّلت الإدارة' : 'عُطلت الإدارة مع حفظ بياناتها التاريخية' };
}

export async function setDeptWeightsAction(year: number, weights: { department_id: string; weight: number }[], note: string): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  const { data, error } = await c.sb.rpc('set_dept_weights', { p_year: year, p_weights: weights, p_note: note || null });
  if (error) return fail(error.message);
  revalidatePath('/', 'layout');
  return { ok: true, message: `اعتُمد الإصدار ${data} من أوزان الإدارات لسنة ${year}م` };
}

export async function saveSettingAction(key: string, value: unknown): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  const { error } = await c.sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return fail(error.message);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُفظ الإعداد' };
}

// ---------- المستخدمون ----------
/**
 * كلمة مرور مؤقتة فريدة وقوية لكل مستخدم (لا تُخزن نصًا صريحًا؛ يحفظها نظام المصادقة مجزأة).
 * سهلة النقل شفهيًا: كلمتان + أرقام + رمز، مثل «Najm-Bahr-4827!»
 */
const WORDS = ['Najm', 'Bahr', 'Nakhl', 'Qamar', 'Sahab', 'Rimal', 'Wadi', 'Jabal', 'Nour', 'Fajr', 'Ghaim', 'Shams', 'Dana', 'Reem', 'Sanad', 'Athar'];
function tempPassword() {
  const w = () => WORDS[randomInt(WORDS.length)];
  return `${w()}-${w()}-${randomInt(1000, 9999)}${'!@#$%'[randomInt(5)]}`;
}

async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** رابط تعيين كلمة مرور لمرة واحدة (لا يحتاج بريدًا؛ ينسخه المسؤول ويرسله للمستخدم) */
async function setupLink(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error || !data.properties?.hashed_token) throw new Error(error?.message ?? 'تعذر إنشاء الرابط');
  return `${await siteOrigin()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/set-password`;
}

export type Credential = { kind: 'link'; link: string } | { kind: 'password'; password: string };

export async function createUserAction(input: {
  email: string;
  full_name: string;
  role: string;
  department_id: string | null;
  job_title?: string;
  method?: 'link' | 'password';
}): Promise<{ ok: true; credential: Credential } | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('إدارة المستخدمين للمدير التنفيذي ومسؤول النظام');
  if (!input.full_name.trim()) return fail('اكتب اسم المستخدم');
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) return fail('بريد غير صالح');
  if ((input.role === 'dept_manager' || input.role === 'employee') && !input.department_id) return fail('حدد الإدارة لمدير الإدارة والموظف');
  const email = input.email.trim().toLowerCase();
  const admin = createAdminClient();
  const method = input.method ?? 'link';
  // مع رابط الإعداد تُنشأ كلمة مرور عشوائية طويلة لا يعرفها أحد ثم يعينها المستخدم بنفسه
  const password = method === 'password' ? tempPassword() : randomBytes(24).toString('base64url') + 'aA1!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name.trim() },
    app_metadata: { role: input.role, department_id: input.department_id },
  });
  if (error) return fail(error.message.includes('already') ? 'البريد مسجل مسبقًا' : error.message);
  await admin
    .from('profiles')
    .update({ full_name: input.full_name.trim(), job_title: input.job_title || null, role: input.role, department_id: input.department_id, must_change_password: true })
    .eq('id', data.user!.id);
  revalidatePath('/settings/users');
  try {
    return { ok: true, credential: method === 'password' ? { kind: 'password', password } : { kind: 'link', link: await setupLink(email) } };
  } catch (e) {
    return fail(`أُنشئ الحساب لكن تعذر إنشاء رابط الإعداد: ${(e as Error).message}. استخدم «إعادة تعيين» من قائمة المستخدمين.`);
  }
}

export async function updateUserAction(id: string, patch: { role?: string; department_id?: string | null; is_active?: boolean; full_name?: string; job_title?: string | null }): Promise<ActionResult> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (id === c.id && (patch.role !== undefined || patch.is_active !== undefined)) return fail('لا يمكنك تعديل دورك أو حالة حسابك بنفسك');
  // التحديث بجلسة المستخدم أولًا ليخضع للصلاحيات في قاعدة البيانات
  const { data, error } = await c.sb.from('profiles').update(patch).eq('id', id).select('id,role,department_id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('لا تملك صلاحية تعديل هذا المستخدم');
  if (patch.role !== undefined || patch.department_id !== undefined) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(id, { app_metadata: { role: data[0].role, department_id: data[0].department_id } });
  }
  if (patch.is_active === false) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  } else if (patch.is_active === true) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });
  }
  revalidatePath('/settings/users');
  return { ok: true, message: 'حُدث المستخدم' };
}

/** إعادة تعيين الدخول: رابط لمرة واحدة (افتراضي) أو كلمة مرور مؤقتة؛ يُطلب من المستخدم تعيين كلمته عند الدخول */
export async function resetPasswordAction(id: string, method: 'link' | 'password' = 'link'): Promise<{ ok: true; credential: Credential } | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('غير مصرح');
  const admin = createAdminClient();
  const { data: u, error: ue } = await admin.auth.admin.getUserById(id);
  if (ue || !u.user?.email) return fail('المستخدم غير موجود');
  await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
  if (method === 'password') {
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return fail(error.message);
    return { ok: true, credential: { kind: 'password', password } };
  }
  try {
    return { ok: true, credential: { kind: 'link', link: await setupLink(u.user.email) } };
  } catch (e) {
    return fail((e as Error).message);
  }
}

function passwordProblem(p: string): string | null {
  if (p.length < 10) return 'كلمة المرور 10 أحرف على الأقل';
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/\d/.test(p)) return 'استخدم أحرفًا وأرقامًا معًا';
  if (/^(.)\1+$/.test(p) || /^(?:1234567890|0123456789|password|qwerty)/i.test(p)) return 'كلمة المرور ضعيفة جدًا';
  return null;
}

export async function changeOwnPasswordAction(password: string): Promise<ActionResult> {
  const bad = passwordProblem(password);
  if (bad) return fail(bad);
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return fail(error.message.includes('different') ? 'اختر كلمة مرور مختلفة عن السابقة' : error.message);
  await sb.rpc('password_changed');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'تغيرت كلمة المرور' };
}

/** طلب رابط استعادة كلمة المرور بالبريد (يتطلب إعداد البريد في Supabase) */
export async function requestPasswordResetAction(email: string): Promise<ActionResult> {
  const e = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) return fail('أدخل بريدًا صحيحًا');
  const sb = await createClient();
  await sb.auth.resetPasswordForEmail(e, { redirectTo: `${await siteOrigin()}/auth/confirm?next=/set-password` });
  // رسالة موحدة لا تكشف إن كان البريد مسجلًا
  return { ok: true, message: 'إن كان البريد مسجلًا فستصلك رسالة برابط تعيين كلمة المرور خلال دقائق.' };
}
