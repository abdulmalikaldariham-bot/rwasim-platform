'use server';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
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
  return 'Rw-' + randomBytes(9).toString('base64url');
}

export async function createUserAction(input: { email: string; full_name: string; role: string; department_id: string | null; job_title?: string }): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('إدارة المستخدمين للمدير التنفيذي ومسؤول النظام');
  if (!/^\S+@\S+\.\S+$/.test(input.email)) return fail('بريد غير صالح');
  if ((input.role === 'dept_manager' || input.role === 'employee') && !input.department_id) return fail('حدد الإدارة لمدير الإدارة والموظف');
  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name.trim() },
    app_metadata: { role: input.role, department_id: input.department_id },
  });
  if (error) return fail(error.message.includes('already') ? 'البريد مسجل مسبقًا' : error.message);
  await admin.from('profiles').update({ full_name: input.full_name.trim(), job_title: input.job_title || null, role: input.role, department_id: input.department_id }).eq('id', data.user!.id);
  revalidatePath('/settings/users');
  return { ok: true, password };
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

export async function resetPasswordAction(id: string): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const c = await caller();
  if (!c) return fail('انتهت الجلسة');
  if (c.role !== 'executive_director' && c.role !== 'system_admin') return fail('غير مصرح');
  const password = tempPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) return fail(error.message);
  return { ok: true, password };
}

export async function changeOwnPasswordAction(password: string): Promise<ActionResult> {
  if (password.length < 10) return fail('كلمة المرور 10 أحرف على الأقل');
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return fail(error.message);
  return { ok: true, message: 'تغيرت كلمة المرور' };
}
