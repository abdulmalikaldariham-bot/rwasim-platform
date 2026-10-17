'use server';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { passwordProblem } from '@/lib/password';
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
function tempPassword() {
  // كلمة مرور مؤقتة فريدة وعشوائية (≈ 96 بت) تُعرض مرة واحدة ولا تُخزن في المنصة
  return 'Rw-' + randomBytes(12).toString('base64url') + '-' + (randomBytes(1)[0] % 90 + 10);
}

async function siteOrigin() {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** رابط تفعيل/استعادة يُنشأ دون إرسال بريد (يسلّمه المسؤول للمستخدم)، صالح لمدة محدودة وللاستخدام مرة واحدة */
async function actionLink(kind: 'invite' | 'recovery', email: string, data?: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data: l, error } = await admin.auth.admin.generateLink(
    kind === 'invite' ? { type: 'invite', email, options: { data } } : { type: 'recovery', email },
  );
  if (error || !l?.properties?.hashed_token) return { error: error?.message ?? 'تعذر إنشاء الرابط', user: null as null | { id: string } };
  const origin = await siteOrigin();
  return {
    link: `${origin}/auth/confirm?token_hash=${encodeURIComponent(l.properties.hashed_token)}&type=${kind}&next=/auth/set-password`,
    user: l.user,
  };
}

type Access = { password?: string; link?: string };

export async function createUserAction(input: {
  email: string;
  full_name: string;
  role: string;
  department_id: string | null;
  job_title?: string;
  method?: 'invite' | 'temp';
}): Promise<({ ok: true } & Access) | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('إدارة المستخدمين للمدير التنفيذي ومسؤول النظام');
  const email = input.email.trim().toLowerCase();
  const name = input.full_name.trim();
  if (name.length < 3) return fail('اكتب الاسم الكامل');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('بريد غير صالح');
  if (!['executive_director', 'dept_manager', 'employee', 'board_member', 'system_admin'].includes(input.role)) return fail('دور غير صالح');
  if ((input.role === 'dept_manager' || input.role === 'employee') && !input.department_id) return fail('حدد الإدارة لمدير الإدارة والموظف');
  if (input.role === 'executive_director' && c.role !== 'executive_director') return fail('إنشاء حساب مدير تنفيذي من صلاحية المدير التنفيذي');
  const admin = createAdminClient();
  const meta = { role: input.role, department_id: input.department_id };
  let userId: string;
  const out: Access = {};
  if (input.method === 'invite') {
    const r = await actionLink('invite', email, { full_name: name });
    if (!r.user) return fail(r.error?.includes('already') ? 'البريد مسجل مسبقًا' : r.error ?? 'تعذر إنشاء الدعوة');
    userId = r.user.id;
    out.link = r.link;
    const u = await admin.auth.admin.updateUserById(userId, { app_metadata: meta, user_metadata: { full_name: name } });
    if (u.error) return fail(u.error.message);
  } else {
    out.password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password: out.password, email_confirm: true, user_metadata: { full_name: name }, app_metadata: meta });
    if (error) return fail(error.message.includes('already') ? 'البريد مسجل مسبقًا' : error.message);
    userId = data.user!.id;
  }
  await admin
    .from('profiles')
    .update({ full_name: name, job_title: input.job_title || null, role: input.role, department_id: input.department_id, is_active: true, must_change_password: true })
    .eq('id', userId);
  revalidatePath('/settings/users');
  return { ok: true, ...out };
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

/** إعادة تعيين الوصول: كلمة مرور مؤقتة جديدة أو رابط استعادة — وفي الحالتين يُطلب تغييرها عند الدخول */
export async function resetPasswordAction(id: string, method: 'temp' | 'link' = 'temp'): Promise<({ ok: true } & Access) | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('غير مصرح');
  if (id === c.id) return fail('غيّر كلمة مرورك من صفحة «حسابي»');
  const admin = createAdminClient();
  const { data: prof } = await admin.from('profiles').select('email,role').eq('id', id).single();
  if (!prof?.email) return fail('المستخدم غير موجود');
  if (prof.role === 'executive_director' && c.role !== 'executive_director') return fail('غير مصرح');
  const out: Access = {};
  if (method === 'link') {
    const r = await actionLink('recovery', prof.email);
    if (!r.link) return fail(r.error ?? 'تعذر إنشاء الرابط');
    out.link = r.link;
  } else {
    out.password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(id, { password: out.password });
    if (error) return fail(error.message);
  }
  await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
  return { ok: true, ...out };
}

/** تغيير كلمة المرور من صفحة الحساب: يتطلب كلمة المرور الحالية */
export async function changeOwnPasswordAction(current: string, password: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.email) return fail('انتهت الجلسة');
  const problem = passwordProblem(password, u.user.email);
  if (problem) return fail(problem);
  if (current === password) return fail('اختر كلمة مرور مختلفة عن الحالية');
  // التحقق من كلمة المرور الحالية بعميل مستقل لا يمس جلسة المتصفح
  const probe = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const chk = await probe.auth.signInWithPassword({ email: u.user.email, password: current });
  if (chk.error) return fail('كلمة المرور الحالية غير صحيحة');
  await probe.auth.signOut({ scope: 'local' }); // يُنهي جلسة التحقق فقط لا جلسة المتصفح
  const { error } = await sb.auth.updateUser({ password });
  if (error) return fail(error.message.includes('different') ? 'اختر كلمة مرور مختلفة عن الحالية' : error.message);
  await sb.rpc('clear_must_change_password');
  return { ok: true, message: 'تغيرت كلمة المرور' };
}

/** تعيين كلمة مرور جديدة بعد الدعوة أو الاستعادة أو أول دخول بكلمة مؤقتة (الجلسة قائمة) */
export async function setNewPasswordAction(password: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return fail('انتهت صلاحية الرابط أو الجلسة. اطلب رابطًا جديدًا');
  const problem = passwordProblem(password, u.user.email);
  if (problem) return fail(problem);
  const { error } = await sb.auth.updateUser({ password });
  if (error) return fail(error.message.includes('different') ? 'اختر كلمة مرور مختلفة عن المؤقتة' : error.message);
  const r = await sb.rpc('clear_must_change_password');
  if (r.error) return fail(r.error.message);
  return { ok: true, message: 'حُفظت كلمة المرور' };
}
