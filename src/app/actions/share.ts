'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './steps';

export interface ShareLinkInput {
  name: string;
  year: number;
  quarter: number | null;
  allowNav: boolean;
  sections: { ops: boolean; departments: boolean; curve: boolean; exec: boolean; activity_titles: boolean };
  kpiIds: string[];
  kpiLimit: number;
  expiresAt: string | null;
  refreshSeconds: number;
  /** null = بلا رمز، '' = إبقاء الرمز الحالي، نص = رمز جديد */
  accessCode: string | null;
}

const fail = (m: string): { ok: false; error: string } => ({ ok: false, error: m });

function validate(i: ShareLinkInput): string | null {
  if (!i.name.trim()) return 'اكتب اسمًا وصفيًا للرابط';
  if (i.name.trim().length > 120) return 'الاسم طويل';
  if (!i.sections.ops && !i.sections.exec) return 'اختر محورًا واحدًا على الأقل للعرض';
  if (i.accessCode && (i.accessCode.trim().length < 4 || i.accessCode.length > 64)) return 'رمز الوصول من 4 إلى 64 خانة';
  if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now()) return 'تاريخ الانتهاء في الماضي';
  return null;
}

function row(i: ShareLinkInput) {
  return {
    name: i.name.trim(),
    year: i.year,
    quarter: i.quarter,
    allow_period_nav: i.allowNav,
    sections: i.sections,
    kpi_ids: i.kpiIds.length ? i.kpiIds : null,
    kpi_limit: Math.min(40, Math.max(1, Math.round(i.kpiLimit))),
    expires_at: i.expiresAt ? new Date(i.expiresAt).toISOString() : null,
    refresh_seconds: Math.min(3600, Math.max(30, Math.round(i.refreshSeconds))),
  };
}

export async function createShareLinkAction(i: ShareLinkInput): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const v = validate(i);
  if (v) return fail(v);
  const sb = await createClient();
  const { data, error } = await sb.from('share_links').insert(row(i)).select('id,token').single();
  if (error) return fail(error.message.includes('row-level') ? 'إدارة روابط العرض من صلاحية المدير التنفيذي' : error.message);
  if (i.accessCode) {
    const c = await sb.rpc('set_share_link_code', { p_id: data.id, p_code: i.accessCode });
    if (c.error) {
      await sb.from('share_links').delete().eq('id', data.id);
      return fail(c.error.message);
    }
  }
  revalidatePath('/share');
  return { ok: true, token: data.token };
}

export async function updateShareLinkAction(id: string, i: ShareLinkInput): Promise<ActionResult> {
  const v = validate(i);
  if (v) return fail(v);
  const sb = await createClient();
  const { data, error } = await sb.from('share_links').update(row(i)).eq('id', id).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط غير متاح');
  if (i.accessCode !== '') {
    const c = await sb.rpc('set_share_link_code', { p_id: id, p_code: i.accessCode });
    if (c.error) return fail(c.error.message);
  }
  revalidatePath('/share');
  return { ok: true, message: 'حُفظت إعدادات الرابط' };
}

export async function toggleShareLinkAction(id: string, active: boolean): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.from('share_links').update({ is_active: active, revoked_at: null }).eq('id', id).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط غير متاح');
  revalidatePath('/share');
  return { ok: true, message: active ? 'فُعّل الرابط' : 'عُطّل الرابط مؤقتًا' };
}

export async function revokeShareLinkAction(id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.from('share_links').delete().eq('id', id).select('id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('الرابط غير متاح');
  revalidatePath('/share');
  return { ok: true, message: 'أُلغي الرابط نهائيًا ولم يعد يعمل' };
}
