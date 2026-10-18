'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function errMsg(e: { message: string } | null | undefined): string {
  return e?.message?.replace(/^.*?:\s*(?=[؀-ۿ])/, '') ?? 'تعذر تنفيذ العملية';
}

export async function updateStepAction(input: { stepId: string; status: string; note?: string; doneSubsteps?: string[] | null; outputAchieved?: string | null }): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('update_step_progress', {
    p_step: input.stepId,
    p_status: input.status,
    p_note: input.note?.trim() || null,
    p_done_substeps: input.doneSubsteps ?? null,
    p_output_achieved: input.outputAchieved?.trim() || null,
  });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'تم تحديث المهمة' };
}

export async function addNoteAction(stepId: string, note: string): Promise<ActionResult> {
  if (!note.trim()) return { ok: false, error: 'اكتب الملاحظة أولًا' };
  const sb = await createClient();
  const { error } = await sb.rpc('add_step_note', { p_step: stepId, p_note: note.trim() });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'أضيفت الملاحظة' };
}

const SAFE = /[^A-Za-z0-9._-]+/g;

export async function uploadEvidenceAction(form: FormData): Promise<ActionResult> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, error: 'انتهت الجلسة' };
  const stepId = String(form.get('stepId'));
  const note = String(form.get('note') ?? '').trim() || null;
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'اختر ملفًا' };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: 'الحد الأقصى لحجم الشاهد 25 ميجابايت' };
  const { data: step } = await sb.from('steps').select('id,plan_id').eq('id', stepId).single();
  if (!step) return { ok: false, error: 'المهمة غير متاحة' };
  const ext = (file.name.split('.').pop() ?? 'bin').replace(SAFE, '').slice(0, 8);
  const path = `${step.plan_id}/${step.id}/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from('evidence').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (up.error) return { ok: false, error: 'لا تملك صلاحية رفع شاهد لهذه المهمة أو أن الخطة غير معتمدة' };
  const { error } = await sb.from('evidence').insert({
    step_id: step.id,
    plan_id: step.plan_id,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    note,
    uploaded_by: u.user.id,
  });
  if (error) {
    await sb.storage.from('evidence').remove([path]);
    return { ok: false, error: errMsg(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'تم رفع الشاهد' };
}

export async function evidenceUrlAction(path: string): Promise<{ url?: string; error?: string }> {
  const sb = await createClient();
  const { data, error } = await sb.storage.from('evidence').createSignedUrl(path, 120);
  if (error || !data) return { error: 'لا يمكن فتح الملف' };
  return { url: data.signedUrl };
}

export async function raiseEscalationAction(input: { stepId?: string; activityId?: string; departmentId: string; kind: string; title: string; details?: string }): Promise<ActionResult> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!input.title.trim()) return { ok: false, error: 'اكتب عنوان الطلب' };
  const { error } = await sb.from('escalations').insert({
    kind: input.kind,
    step_id: input.stepId ?? null,
    activity_id: input.activityId ?? null,
    department_id: input.departmentId,
    title: input.title.trim(),
    details: input.details?.trim() || null,
    raised_by: u.user?.id,
  });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'رُفع الطلب للمدير التنفيذي' };
}

export async function assignStepAction(stepId: string, assigneeId: string | null): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('steps').update({ assignee_id: assigneeId }).eq('id', stepId);
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: assigneeId ? 'تم التفويض' : 'أُلغي التفويض' };
}

// ---------------------------------------------------------------------
// المخرجات، الروابط، التواريخ، الإسناد
// ---------------------------------------------------------------------

export async function saveOutputAction(stepId: string, text: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('save_step_output', { p_step: stepId, p_output: text });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُفظ المخرج المتحقق' };
}

export async function addEvidenceLinkAction(stepId: string, url: string, title: string, note?: string): Promise<ActionResult> {
  if (!/^https?:\/\/\S+\.\S+/i.test(url.trim())) return { ok: false, error: 'أدخل رابطًا صحيحًا يبدأ بـ https://' };
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  const { data: step } = await sb.from('steps').select('id,plan_id').eq('id', stepId).single();
  if (!step) return { ok: false, error: 'المهمة غير متاحة' };
  const { error } = await sb.from('evidence').insert({
    step_id: step.id,
    plan_id: step.plan_id,
    kind: 'link',
    url: url.trim(),
    file_name: title.trim() || url.trim(),
    note: note?.trim() || null,
    uploaded_by: u.user?.id,
  });
  if (error) return { ok: false, error: error.message.includes('row-level') ? 'لا تملك صلاحية إضافة شاهد لهذه المهمة أو أن الخطة غير معتمدة' : errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'أضيف رابط الشاهد' };
}

export async function deleteEvidenceAction(id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data: ev } = await sb.from('evidence').select('storage_path').eq('id', id).single();
  const { data, error } = await sb.from('evidence').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: errMsg(error) };
  if (!data?.length) return { ok: false, error: 'لا تملك صلاحية حذف هذا الشاهد' };
  if (ev?.storage_path) await sb.storage.from('evidence').remove([ev.storage_path]);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُذف الشاهد' };
}

export async function setDatesAction(stepId: string, start: string | null, end: string | null): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('set_step_dates', { p_step: stepId, p_start: start || null, p_end: end || null });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: start ? 'حُفظت التواريخ' : 'أعيدت التواريخ إلى الجدولة الأسبوعية' };
}

export async function setAssigneesAction(input: { stepId: string; users: string[]; lead: string | null; mode: 'shared' | 'individual'; threshold: number; all: boolean }): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('set_step_assignees', {
    p_step: input.stepId,
    p_users: input.users,
    p_lead: input.lead,
    p_mode: input.mode,
    p_threshold: input.threshold,
    p_all: input.all,
  });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: Number(data) ? `أُسندت المهمة إلى ${data} ${Number(data) === 1 ? 'مكلف' : 'مكلفين'}` : 'أُلغي الإسناد' };
}

export async function setAssigneeProgressAction(stepId: string, done: boolean, note: string, userId?: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('set_assignee_progress', { p_step: stepId, p_done: done, p_note: note?.trim() || null, p_user: userId ?? null });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: done ? 'سُجل الإنجاز' : 'أُلغي تسجيل الإنجاز' };
}

export async function setOutputPolicyAction(stepId: string, policy: 'none' | 'description' | 'evidence'): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('set_step_output_policy', { p_step: stepId, p_policy: policy });
  if (error) return { ok: false, error: errMsg(error) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُدّث شرط توثيق المخرج' };
}
