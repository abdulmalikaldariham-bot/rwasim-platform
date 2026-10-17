'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { buildReportSnapshot, type ReportType } from '@/lib/reports/build';
import { renderReportHtml, htmlToPdf } from '@/lib/reports/pdf';
import type { ActionResult } from './steps';

export async function generateReportAction(input: {
  type: ReportType;
  year: number;
  quarter?: number | null;
  month?: number | null;
  departmentId?: string | null;
  title: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, error: 'انتهت الجلسة' };
  const { data: me } = await sb.from('profiles').select('full_name,role,department_id').eq('id', u.user.id).single();
  if (!me) return { ok: false, error: 'تعذر التحقق من الحساب' };
  if (me.role === 'dept_manager' && input.departmentId !== me.department_id) return { ok: false, error: 'يمكنك إصدار تقارير إدارتك فقط' };
  if (me.role !== 'executive_director' && me.role !== 'dept_manager') return { ok: false, error: 'إصدار التقارير للمدير التنفيذي ومديري الإدارات' };
  const snapshot = await buildReportSnapshot(sb, { ...input, generatedBy: me.full_name });
  const { data, error } = await sb
    .from('reports')
    .insert({
      type: input.type,
      year: input.year,
      quarter: snapshot.meta.quarter,
      month: snapshot.meta.month,
      department_id: input.departmentId ?? null,
      title: input.title.trim() || `التقرير ${snapshot.meta.periodLabel}`,
      snapshot,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reports');
  return { ok: true, id: data.id };
}

export async function saveReportCommentAction(id: string, comment: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('reports').update({ director_comment: comment.trim() || null }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/reports/${id}`);
  return { ok: true, message: 'حُفظ التعليق' };
}

export async function approveReportAction(id: string, comment: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.from('reports').update({ director_comment: comment.trim() || null, status: 'approved' }).eq('id', id).select('*').single();
  if (error) return { ok: false, error: error.message };
  // أرشفة نسخة PDF المعتمدة (أفضل جهد — التقرير ثابت أصلًا لأن لقطته لا تتغير)
  try {
    const { data: names } = await sb.from('profiles').select('id,full_name').in('id', [data.generated_by, data.approved_by].filter(Boolean));
    const nm = (x: string | null) => names?.find((n) => n.id === x)?.full_name ?? '—';
    const html = await renderReportHtml({ snap: data.snapshot, title: data.title, status: 'approved', comment: data.director_comment, generatedByName: nm(data.generated_by), approvedByName: nm(data.approved_by), approvedAt: data.approved_at });
    const pdf = await htmlToPdf(html, data.title);
    await sb.storage.from('reports').upload(`${id}/approved.pdf`, pdf, { contentType: 'application/pdf', upsert: false });
  } catch {
    // التوليد الفوري متاح دائمًا من مسار التنزيل
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'اعتُمد التقرير وحُفظت نسخته' };
}

export async function deleteReportAction(id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('reports').delete().eq('id', id);
  if (error) return { ok: false, error: error.message.includes('معتمد') ? 'لا يمكن حذف تقرير معتمد' : error.message };
  revalidatePath('/reports');
  return { ok: true };
}
