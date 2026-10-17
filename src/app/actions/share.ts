'use server';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './steps';

const fail = (m: string): { ok: false; error: string } => ({ ok: false, error: m });

async function ed() {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data: p } = await sb.from('profiles').select('role,is_active').eq('id', u.user.id).single();
  if (!p?.is_active || p.role !== 'executive_director') return null;
  return { sb, id: u.user.id };
}

export interface ShareLinkInput {
  name: string;
  follow_current: boolean;
  year: number | null;
  quarter: number | null;
  allow_period_switch: boolean;
  show_operational: boolean;
  show_executive: boolean;
  show_activities: boolean;
  kpi_ids: string[] | null;
  kpi_limit: number;
  refresh_seconds: number;
  expires_at: string | null; // YYYY-MM-DD (نهاية اليوم بتوقيت الرياض)
}

function clean(i: ShareLinkInput) {
  const name = String(i.name ?? '').trim();
  if (name.length < 3) return { error: 'اكتب اسمًا واضحًا للرابط' } as const;
  if (!i.show_operational && !i.show_executive) return { error: 'اختر محورًا واحدًا على الأقل' } as const;
  if (!i.follow_current && (!i.year || !i.quarter)) return { error: 'حدد السنة والربع، أو اختر «الفترة الحالية دائمًا»' } as const;
  const refresh = Math.min(3600, Math.max(30, Math.round(Number(i.refresh_seconds) || 300)));
  const limit = Math.min(40, Math.max(1, Math.round(Number(i.kpi_limit) || 9)));
  let expires: string | null = null;
  if (i.expires_at) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.expires_at)) return { error: 'تاريخ انتهاء غير صالح' } as const;
    expires = `${i.expires_at}T23:59:59+03:00`;
    if (Date.parse(expires) < Date.now()) return { error: 'تاريخ الانتهاء في الماضي' } as const;
  }
  return {
    row: {
      name: name.slice(0, 120),
      follow_current: !!i.follow_current,
      year: i.follow_current ? null : i.year,
      quarter: i.follow_current ? null : i.quarter,
      allow_period_switch: !!i.allow_period_switch,
      show_operational: !!i.show_operational,
      show_executive: !!i.show_executive,
      show_activities: !!i.show_activities,
      kpi_ids: i.kpi_ids && i.kpi_ids.length ? i.kpi_ids : null,
      kpi_limit: limit,
      refresh_seconds: refresh,
      expires_at: expires,
    },
  } as const;
}

export async function createShareLinkAction(input: ShareLinkInput & { code?: string | null }): Promise<ActionResult & { token?: string }> {
  const c = await ed();
  if (!c) return fail('إنشاء روابط العرض من صلاحية المدير التنفيذي');
  const v = clean(input);
  if ('error' in v) return fail(v.error!);
  const code = input.code?.trim() || null;
  if (code && code.length < 6) return fail('رمز الوصول 6 أحرف على الأقل');
  // 32 بايت عشوائية آمنة = 256 بت (43 حرفًا base64url)
  const token = randomBytes(32).toString('base64url');
  const { data, error } = await c.sb.from('share_links').insert({ ...v.row, token, created_by: c.id }).select('id').single();
  if (error) return fail(error.message);
  if (code) {
    const r = await c.sb.rpc('set_share_link_code', { p_id: data.id, p_code: code });
    if (r.error) {
      await c.sb.from('share_links').delete().eq('id', data.id);
      return fail(r.error.message);
    }
  }
  revalidatePath('/share-links');
  return { ok: true, message: 'أُنشئ الرابط', token };
}

export async function updateShareLinkAction(id: string, input: ShareLinkInput): Promise<ActionResult> {
  const c = await ed();
  if (!c) return fail('من صلاحية المدير التنفيذي');
  const v = clean(input);
  if ('error' in v) return fail(v.error!);
  const { data, error } = await c.sb.from('share_links').update(v.row).eq('id', id).is('revoked_at', null).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط غير موجود أو أُلغي');
  revalidatePath('/share-links');
  return { ok: true, message: 'حُفظت الإعدادات' };
}

export async function setShareCodeAction(id: string, code: string | null): Promise<ActionResult> {
  const c = await ed();
  if (!c) return fail('من صلاحية المدير التنفيذي');
  const { error } = await c.sb.rpc('set_share_link_code', { p_id: id, p_code: code?.trim() || null });
  if (error) return fail(error.message);
  revalidatePath('/share-links');
  return { ok: true, message: code ? 'حُدّث رمز الوصول؛ الشاشات المفتوحة ستطلب الرمز الجديد' : 'أُزيل رمز الوصول' };
}

/** إيقاف مؤقت/تفعيل */
export async function toggleShareLinkAction(id: string, active: boolean): Promise<ActionResult> {
  const c = await ed();
  if (!c) return fail('من صلاحية المدير التنفيذي');
  const { data, error } = await c.sb.from('share_links').update({ is_active: active }).eq('id', id).is('revoked_at', null).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط ملغى نهائيًا');
  revalidatePath('/share-links');
  return { ok: true, message: active ? 'فُعّل الرابط' : 'أُوقف الرابط؛ ستتوقف الشاشات المفتوحة عند التحديث التالي' };
}

/** إلغاء نهائي: لا يمكن التراجع، والرمز لا يعود صالحًا أبدًا */
export async function revokeShareLinkAction(id: string): Promise<ActionResult> {
  const c = await ed();
  if (!c) return fail('من صلاحية المدير التنفيذي');
  const { error } = await c.sb.from('share_links').update({ is_active: false, revoked_at: new Date().toISOString() }).eq('id', id);
  if (error) return fail(error.message);
  revalidatePath('/share-links');
  return { ok: true, message: 'أُلغي الرابط نهائيًا' };
}

/** إصدار رمز جديد بنفس الإعدادات (يبطل الرابط القديم) */
export async function rotateShareTokenAction(id: string): Promise<ActionResult & { token?: string }> {
  const c = await ed();
  if (!c) return fail('من صلاحية المدير التنفيذي');
  const token = randomBytes(32).toString('base64url');
  const { data, error } = await c.sb.from('share_links').update({ token }).eq('id', id).is('revoked_at', null).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط ملغى نهائيًا');
  revalidatePath('/share-links');
  return { ok: true, message: 'صدر رابط جديد وأُبطل القديم', token };
}
