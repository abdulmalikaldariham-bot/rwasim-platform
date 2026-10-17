'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parseOperationalWorkbook, matchDepartment, type ParsedSheet, type ParsedWorkbook } from '@/lib/import/operational';
import { buildPlanProposal, createPlanFromProposal, applyReimport, type ImportOptions, type ReimportDecisions } from '@/lib/import/apply';
import { diffPlan, type PlanDiff } from '@/lib/import/diff';
import type { ActionResult } from './steps';

const fail = (e: { message: string } | string | null | undefined): { ok: false; error: string } => ({
  ok: false,
  error: typeof e === 'string' ? e : e?.message?.replace(/^.*?:\s*(?=[؀-ۿ])/, '') ?? 'تعذر تنفيذ العملية',
});

async function userId(sb: Awaited<ReturnType<typeof createClient>>) {
  return (await sb.auth.getUser()).data.user?.id ?? null;
}

// ---------------------------------------------------------------------
// الاستيراد
// ---------------------------------------------------------------------

export interface ParsedUpload {
  importId: string | null;
  fileName: string;
  workbook: ParsedWorkbook;
  suggestions: { sheetName: string; departmentId: string | null; confidence: 'high' | 'low' | null }[];
}

export async function parseOperationalFileAction(form: FormData): Promise<{ ok: true; data: ParsedUpload } | { ok: false; error: string }> {
  const sb = await createClient();
  const uid = await userId(sb);
  const file = form.get('file');
  const year = Number(form.get('year'));
  const quarter = Number(form.get('quarter'));
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx')) return fail('اختر ملف Excel بصيغة xlsx');
  if (file.size > 10 * 1024 * 1024) return fail('حجم الملف أكبر من 10 ميجابايت');
  let workbook: ParsedWorkbook;
  try {
    workbook = await parseOperationalWorkbook(await file.arrayBuffer());
  } catch {
    return fail('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم.');
  }
  if (!workbook.sheets.length) return fail('لم يُعثر في الملف على أي ورقة بصيغة الخطة التشغيلية');
  const { data: depts } = await sb.from('departments').select('id,name,short_name').eq('is_active', true);
  const suggestions = workbook.sheets.map((s) => {
    const m = matchDepartment(s.departmentHint, s.sheetName, depts ?? []);
    return { sheetName: s.sheetName, departmentId: m?.id ?? null, confidence: m?.confidence ?? null };
  });
  // حفظ نسخة من الملف وسجل الاستيراد للرجوع إليه
  let importId: string | null = null;
  const path = `${uid}/${Date.now()}.xlsx`;
  const up = await sb.storage.from('imports').upload(path, file, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const ins = await sb
    .from('plan_imports')
    .insert({ kind: 'operational', year, quarter, file_name: file.name, storage_path: up.error ? null : path, parsed: workbook, issues: workbook.sheets.flatMap((s) => s.issues), created_by: uid })
    .select('id')
    .single();
  if (!ins.error) importId = ins.data.id;
  return { ok: true, data: { importId, fileName: file.name, workbook, suggestions } };
}

export async function createPlansFromImportAction(input: {
  year: number;
  quarter: number;
  importId: string | null;
  sheets: { departmentId: string; sheet: ParsedSheet }[];
  options: ImportOptions;
}): Promise<{ ok: true; planIds: string[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const created: string[] = [];
  for (const s of input.sheets) {
    try {
      const proposal = buildPlanProposal(s.sheet.activities, input.quarter, input.options);
      const id = await createPlanFromProposal(sb, {
        year: input.year,
        quarter: input.quarter,
        departmentId: s.departmentId,
        title: s.sheet.title ?? undefined,
        importId: input.importId,
        proposal,
      });
      created.push(id);
    } catch (e) {
      return fail(`${s.sheet.sheetName}: ${(e as Error).message}${created.length ? ` (أنشئت ${created.length} خطط قبل الخطأ)` : ''}`);
    }
  }
  if (input.importId) await sb.from('plan_imports').update({ applied_at: new Date().toISOString(), applied_plan_ids: created }).eq('id', input.importId);
  revalidatePath('/', 'layout');
  return { ok: true, planIds: created };
}

export async function reimportPreviewAction(form: FormData): Promise<{ ok: true; diff: PlanDiff; sheetName: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const planId = String(form.get('planId'));
  const file = form.get('file');
  if (!(file instanceof File)) return fail('اختر الملف');
  const { data: plan } = await sb.from('op_plans').select('id,department_id').eq('id', planId).single();
  if (!plan) return fail('الخطة غير متاحة');
  const wb = await parseOperationalWorkbook(await file.arrayBuffer()).catch(() => null);
  if (!wb) return fail('تعذرت قراءة الملف');
  const { data: depts } = await sb.from('departments').select('id,name,short_name');
  const sheet = wb.sheets.find((s) => matchDepartment(s.departmentHint, s.sheetName, depts ?? [])?.id === plan.department_id) ?? (wb.sheets.length === 1 ? wb.sheets[0] : null);
  if (!sheet) return fail('لا توجد في الملف ورقة تخص هذه الإدارة');
  const { data: acts } = await sb
    .from('activities')
    .select('id,title,steps(id,title,responsible_text,output,progress,status,is_archived,step_weeks(week_index))')
    .eq('plan_id', planId)
    .eq('is_archived', false);
  const existing = (acts ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    steps: (a.steps as { id: string; title: string; responsible_text: string | null; output: string | null; progress: number; status: string; is_archived: boolean; step_weeks: { week_index: number }[] }[])
      .filter((s) => !s.is_archived)
      .map((s) => ({ ...s, progress: Number(s.progress), weeks: s.step_weeks.map((w) => w.week_index) })),
  }));
  return { ok: true, diff: diffPlan(existing, sheet.activities), sheetName: sheet.sheetName };
}

export async function reimportApplyAction(planId: string, diff: PlanDiff, decisions: ReimportDecisions): Promise<ActionResult> {
  const sb = await createClient();
  const { data: plan } = await sb.from('op_plans').select('quarter').eq('id', planId).single();
  if (!plan) return fail('الخطة غير متاحة');
  try {
    const r = await applyReimport(sb, planId, diff, plan.quarter, decisions, { activityWeightMode: 'nature', recurringCycles: true });
    revalidatePath('/', 'layout');
    return {
      ok: true,
      message: r.mode === 'change_request' ? `حُدثت النصوص (${r.applied})، وأُرسلت التعديلات الهيكلية للمدير التنفيذي كطلب تعديل` : `طُبقت ${r.applied} تغييرات على المسودة، وأعيدت موازنة الأوزان`,
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ---------------------------------------------------------------------
// إنشاء يدوي وتعديل الهيكل (المسودات)
// ---------------------------------------------------------------------

export async function createManualPlanAction(input: { year: number; quarter: number; departmentId: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('op_plans')
    .insert({ year: input.year, quarter: input.quarter, department_id: input.departmentId, created_by: await userId(sb) })
    .select('id')
    .single();
  if (error) return fail(error.code === '23505' ? 'توجد خطة لهذه الإدارة في هذا الربع' : error.message.includes('row-level') ? 'لا تملك صلاحية إنشاء خطة لهذه الإدارة' : error);
  revalidatePath('/plans');
  return { ok: true, id: data.id };
}

export async function deletePlanAction(planId: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.from('op_plans').delete().eq('id', planId).select('id');
  if (error) return fail(error);
  if (!data?.length) return fail('يمكن حذف المسودات فقط');
  revalidatePath('/plans');
  return { ok: true };
}

export async function addActivityAction(planId: string, title: string, kind = 'other'): Promise<ActionResult> {
  const sb = await createClient();
  const { data: last } = await sb.from('activities').select('seq').eq('plan_id', planId).order('seq', { ascending: false }).limit(1);
  const { error } = await sb.from('activities').insert({ plan_id: planId, title, kind, seq: (last?.[0]?.seq ?? 0) + 1, weight: 0 });
  if (error) return fail(error);
  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

export async function updateActivityAction(id: string, patch: { title?: string; kind?: string; kpi_id?: string | null; description?: string | null }): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('activities').update(patch).eq('id', id);
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function deleteActivityAction(id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('activities').delete().eq('id', id);
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function upsertStepAction(input: {
  id?: string;
  activityId: string;
  planId: string;
  title: string;
  responsible_text: string | null;
  output: string | null;
  weeks: number[];
}): Promise<ActionResult> {
  const sb = await createClient();
  let id = input.id;
  if (id) {
    const { error } = await sb.from('steps').update({ title: input.title, responsible_text: input.responsible_text, output: input.output }).eq('id', id);
    if (error) return fail(error);
  } else {
    const { data: last } = await sb.from('steps').select('seq').eq('activity_id', input.activityId).order('seq', { ascending: false }).limit(1);
    const { data, error } = await sb
      .from('steps')
      .insert({ activity_id: input.activityId, plan_id: input.planId, title: input.title, responsible_text: input.responsible_text, output: input.output, seq: (last?.[0]?.seq ?? 0) + 1, weight: 0, is_core: false })
      .select('id')
      .single();
    if (error) return fail(error);
    id = data.id;
  }
  const del = await sb.from('step_weeks').delete().eq('step_id', id!);
  if (del.error) return fail(del.error);
  if (input.weeks.length) {
    const { error } = await sb.from('step_weeks').insert(input.weeks.map((w) => ({ step_id: id, week_index: w })));
    if (error) return fail(error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function deleteStepAction(id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('steps').delete().eq('id', id);
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** حفظ أوزان مسودة (أنشطة + خطوات + الخطوة الجوهرية + المراحل الفرعية) */
export async function saveWeightsAction(input: {
  planId: string;
  activities: { id: string; weight: number }[];
  steps: { id: string; weight: number; is_core: boolean }[];
  substeps?: { stepId: string; items: { title: string; weight: number }[] }[];
}): Promise<ActionResult> {
  if ([...input.activities, ...input.steps].some((x) => !(x.weight >= 0) || x.weight > 100)) return fail('الأوزان يجب أن تكون بين 0 و100');
  const sb = await createClient();
  for (const a of input.activities) {
    const { error } = await sb.from('activities').update({ weight: a.weight }).eq('id', a.id).eq('plan_id', input.planId);
    if (error) return fail(error);
  }
  for (const s of input.steps) {
    const { error } = await sb.from('steps').update({ weight: s.weight, is_core: s.is_core }).eq('id', s.id).eq('plan_id', input.planId);
    if (error) return fail(error);
  }
  for (const ss of input.substeps ?? []) {
    const d = await sb.from('substeps').delete().eq('step_id', ss.stepId);
    if (d.error) return fail(d.error);
    if (ss.items.length) {
      const { error } = await sb.from('substeps').insert(ss.items.map((x, i) => ({ step_id: ss.stepId, title: x.title, weight: x.weight, sort_order: i + 1 })));
      if (error) return fail(error);
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُفظت الأوزان' };
}

// ---------------------------------------------------------------------
// دورة الاعتماد
// ---------------------------------------------------------------------

export async function submitPlanAction(planId: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('submit_plan', { p_plan: planId });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'رُفعت الخطة للمدير التنفيذي' };
}

export async function approvePlanAction(planId: string, note?: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('approve_plan', { p_plan: planId, p_note: note || null });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'اعتُمدت الخطة وبدأت متابعتها' };
}

export async function returnPlanAction(planId: string, note: string): Promise<ActionResult> {
  if (!note.trim()) return fail('اكتب سبب الإعادة');
  const sb = await createClient();
  const { error } = await sb.rpc('return_plan', { p_plan: planId, p_note: note.trim() });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'أعيدت الخطة للتعديل' };
}

export async function requestChangeAction(planId: string, kind: 'weights' | 'structure' | 'schedule', payload: object, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return fail('اكتب سبب التعديل');
  const sb = await createClient();
  const { error } = await sb.rpc('request_plan_change', { p_plan: planId, p_kind: kind, p_payload: payload, p_reason: reason.trim() });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'أُرسل طلب التعديل للمدير التنفيذي' };
}

export async function decideChangeAction(requestId: string, approve: boolean, note?: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.rpc('decide_plan_change', { p_request: requestId, p_approve: approve, p_note: note || null });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: approve ? 'اعتُمد التعديل وحُفظ إصدار جديد من الأوزان' : 'رُفض طلب التعديل' };
}

/** تعديل مباشر من المدير التنفيذي على خطة معتمدة (يُنشأ طلب ويعتمد فورًا ليبقى موثقًا) */
export async function directChangeAction(planId: string, kind: 'weights' | 'structure' | 'schedule', payload: object, reason: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('request_plan_change', { p_plan: planId, p_kind: kind, p_payload: payload, p_reason: reason || 'تعديل مباشر من المدير التنفيذي' });
  if (error) return fail(error);
  const d = await sb.rpc('decide_plan_change', { p_request: data, p_approve: true, p_note: 'تعديل مباشر' });
  if (d.error) {
    await sb.rpc('decide_plan_change', { p_request: data, p_approve: false, p_note: 'أُلغي: ' + d.error.message });
    return fail(d.error);
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'طُبق التعديل وحُفظ إصدار جديد من الأوزان' };
}
