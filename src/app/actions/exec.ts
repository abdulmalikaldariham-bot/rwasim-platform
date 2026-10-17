'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parseExecutiveWorkbook, type ParsedExecPlan } from '@/lib/import/executive';
import { matchDepartment } from '@/lib/import/operational';
import type { ActionResult } from './steps';

const err = (e: { message: string } | null) => ({ ok: false as const, error: e?.message ?? 'تعذر تنفيذ العملية' });

async function uid(sb: Awaited<ReturnType<typeof createClient>>) {
  return (await sb.auth.getUser()).data.user?.id ?? null;
}

export async function addMeasurementAction(input: { kpiId: string; value: number; measuredOn: string; note?: string }): Promise<ActionResult> {
  if (!Number.isFinite(input.value)) return { ok: false, error: 'أدخل قيمة رقمية' };
  const sb = await createClient();
  const q = Math.ceil(Number(input.measuredOn.slice(5, 7)) / 3);
  const { error } = await sb.from('kpi_measurements').insert({ kpi_id: input.kpiId, value: input.value, measured_on: input.measuredOn, quarter: q, note: input.note?.trim() || null, recorded_by: await uid(sb) });
  if (error) return err(error.message.includes('row-level') ? { message: 'تسجيل القياس متاح للمدير التنفيذي ومدير الإدارة المسؤولة بعد اعتماد الخطة التنفيذية' } : error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function createExecPlanAction(year: number, title: string): Promise<ActionResult & { id?: string }> {
  const sb = await createClient();
  const { data, error } = await sb.from('exec_plans').insert({ year, title: title || `الخطة التنفيذية ${year}م`, created_by: await uid(sb) }).select('id').single();
  if (error) return err(error);
  revalidatePath('/executive-plan');
  return { ok: true, id: data.id };
}

export async function setExecPlanStatusAction(planId: string, status: 'approved' | 'draft'): Promise<ActionResult> {
  const sb = await createClient();
  const patch = status === 'approved' ? { status, approved_by: await uid(sb), approved_at: new Date().toISOString() } : { status, approved_by: null, approved_at: null };
  const { error } = await sb.from('exec_plans').update(patch).eq('id', planId);
  if (error) return err(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: status === 'approved' ? 'اعتمدت الخطة التنفيذية' : 'أعيدت الخطة إلى مسودة' };
}

export async function upsertAxisAction(input: { planId: string; id?: string; title: string }): Promise<ActionResult> {
  const sb = await createClient();
  const r = input.id
    ? await sb.from('exec_axes').update({ title: input.title }).eq('id', input.id)
    : await sb.from('exec_axes').insert({ plan_id: input.planId, title: input.title, sort_order: Date.now() % 100000 });
  if (r.error) return err(r.error);
  revalidatePath('/executive-plan');
  return { ok: true };
}

export async function upsertGoalAction(input: { planId: string; axisId: string; id?: string; title: string; description?: string }): Promise<ActionResult> {
  const sb = await createClient();
  const r = input.id
    ? await sb.from('exec_goals').update({ title: input.title, description: input.description ?? null }).eq('id', input.id)
    : await sb.from('exec_goals').insert({ plan_id: input.planId, axis_id: input.axisId, title: input.title, description: input.description ?? null, sort_order: Date.now() % 100000 });
  if (r.error) return err(r.error);
  revalidatePath('/executive-plan');
  return { ok: true };
}

export interface KpiInput {
  id?: string;
  planId: string;
  goalId: string;
  code?: string;
  name: string;
  definition?: string;
  calc_method?: string;
  unit?: string;
  kpi_type: string;
  direction: string;
  baseline?: number | null;
  annual_target?: number | null;
  department_id?: string | null;
  frequency: string;
  data_source?: string;
  actual_mode: string;
  targets: Record<number, number | null>;
}

export async function upsertKpiAction(k: KpiInput): Promise<ActionResult> {
  if (!k.name.trim()) return { ok: false, error: 'اكتب اسم المؤشر' };
  const sb = await createClient();
  const row = {
    plan_id: k.planId,
    goal_id: k.goalId,
    code: k.code || null,
    name: k.name.trim(),
    definition: k.definition || null,
    calc_method: k.calc_method || null,
    unit: k.unit || null,
    kpi_type: k.kpi_type,
    direction: k.direction,
    baseline: k.baseline ?? null,
    annual_target: k.annual_target ?? null,
    department_id: k.department_id || null,
    frequency: k.frequency,
    data_source: k.data_source || null,
    actual_mode: k.actual_mode,
  };
  const r = k.id ? await sb.from('kpis').update(row).eq('id', k.id).select('id').single() : await sb.from('kpis').insert(row).select('id').single();
  if (r.error) return err(r.error);
  const kpiId = r.data.id;
  await sb.from('kpi_period_targets').delete().eq('kpi_id', kpiId);
  const t = Object.entries(k.targets)
    .filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v))
    .map(([q, v]) => ({ kpi_id: kpiId, quarter: Number(q), target: v }));
  if (t.length) {
    const tr = await sb.from('kpi_period_targets').insert(t);
    if (tr.error) return err(tr.error);
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'حُفظ المؤشر' };
}

export async function deleteExecItemAction(table: 'exec_axes' | 'exec_goals' | 'kpis', id: string): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) return err(error);
  revalidatePath('/executive-plan');
  return { ok: true };
}

export async function linkActivityKpiAction(activityId: string, kpiId: string | null): Promise<ActionResult> {
  const sb = await createClient();
  const { error } = await sb.from('activities').update({ kpi_id: kpiId }).eq('id', activityId);
  if (error) return err(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: kpiId ? 'رُبط النشاط بالمؤشر' : 'أزيل الربط' };
}

export async function parseExecFileAction(form: FormData): Promise<{ ok: true; parsed: ParsedExecPlan } | { ok: false; error: string }> {
  const f = form.get('file');
  if (!(f instanceof File)) return { ok: false, error: 'اختر ملف Excel' };
  try {
    const parsed = await parseExecutiveWorkbook(await f.arrayBuffer());
    return { ok: true, parsed };
  } catch {
    return { ok: false, error: 'تعذرت قراءة الملف. تأكد أنه بصيغة xlsx.' };
  }
}

/** استيراد خطة تنفيذية من نتيجة التحليل (تنشئ الخطة إن لم توجد وتضيف المحاور والأهداف والمؤشرات) */
export async function applyExecImportAction(year: number, parsed: ParsedExecPlan): Promise<ActionResult> {
  const sb = await createClient();
  let { data: plan } = await sb.from('exec_plans').select('id,status').eq('year', year).maybeSingle();
  if (!plan) {
    const c = await sb.from('exec_plans').insert({ year, title: `الخطة التنفيذية ${year}م`, created_by: await uid(sb) }).select('id,status').single();
    if (c.error) return err(c.error);
    plan = c.data;
  }
  if (plan.status === 'archived') return { ok: false, error: 'خطة هذه السنة مؤرشفة' };
  const { data: depts } = await sb.from('departments').select('id,name,short_name');
  let n = 0;
  for (const [ai, ax] of parsed.axes.entries()) {
    const a = await sb.from('exec_axes').insert({ plan_id: plan.id, title: ax.title, sort_order: ai + 1 }).select('id').single();
    if (a.error) return err(a.error);
    for (const [gi, g] of ax.goals.entries()) {
      const gr = await sb.from('exec_goals').insert({ plan_id: plan.id, axis_id: a.data.id, title: g.title, sort_order: gi + 1 }).select('id').single();
      if (gr.error) return err(gr.error);
      for (const [ki, k] of g.kpis.entries()) {
        const dept = k.department ? matchDepartment(k.department, '', depts ?? []) : null;
        const kr = await sb
          .from('kpis')
          .insert({
            plan_id: plan.id,
            goal_id: gr.data.id,
            code: k.code,
            name: k.name,
            definition: k.definition,
            calc_method: k.calcMethod,
            unit: k.unit,
            kpi_type: k.kpiType,
            direction: k.direction,
            baseline: k.baseline,
            annual_target: k.annualTarget,
            department_id: dept?.id ?? null,
            frequency: k.frequency,
            data_source: k.dataSource,
            sort_order: ki + 1,
          })
          .select('id')
          .single();
        if (kr.error) return err(kr.error);
        const t = Object.entries(k.periodTargets).map(([q, v]) => ({ kpi_id: kr.data.id, quarter: Number(q), target: v }));
        if (t.length) await sb.from('kpi_period_targets').insert(t);
        n++;
      }
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: `استورد ${n} مؤشرًا إلى خطة ${year}م (مسودة)` };
}
