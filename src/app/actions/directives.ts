'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './steps';

export async function createDirectiveAction(input: {
  title: string;
  body?: string;
  target_type: 'general' | 'department' | 'activity' | 'kpi';
  department_id?: string | null;
  activity_id?: string | null;
  kpi_id?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
}): Promise<ActionResult> {
  if (!input.title.trim()) return { ok: false, error: 'اكتب نص التوجيه' };
  const sb = await createClient();
  const uid = (await sb.auth.getUser()).data.user?.id;
  const { error } = await sb.from('directives').insert({
    title: input.title.trim(),
    body: input.body?.trim() || null,
    target_type: input.target_type,
    department_id: input.department_id || null,
    activity_id: input.activity_id || null,
    kpi_id: input.kpi_id || null,
    assignee_id: input.assignee_id || null,
    due_date: input.due_date || null,
    created_by: uid,
  });
  if (error) return { ok: false, error: error.message.includes('row-level') ? 'إضافة التوجيهات من صلاحية المدير التنفيذي' : error.message };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'أضيف التوجيه' };
}

export async function updateDirectiveAction(id: string, status: 'open' | 'in_progress' | 'closed', note: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('update_directive', { p_directive: id, p_status: status, p_note: note || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/', 'layout');
  return { ok: true, message: status === 'closed' ? 'أُغلق التوجيه' : 'حُدثت حالة التوجيه' };
}

export async function resolveEscalationAction(id: string, resolution: string): Promise<ActionResult> {
  const sb = await createClient();
  const uid = (await sb.auth.getUser()).data.user?.id;
  const { error } = await sb.from('escalations').update({ status: 'resolved', resolution: resolution || null, resolved_by: uid, resolved_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'سُجل القرار' };
}
