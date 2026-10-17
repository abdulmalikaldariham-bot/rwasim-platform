// =====================================================================
// تطبيق نتيجة الاستيراد على قاعدة البيانات بجلسة المستخدم (تخضع لـ RLS)
// =====================================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedActivity, ParsedSheet } from './operational';
import type { PlanDiff } from './diff';
import {
  classifyActivity,
  normalizeTo100,
  suggestActivityWeightsByNature,
  suggestActivityWeightsEqual,
  suggestCycleSubsteps,
  suggestStepWeights,
} from '../engine/weights';
import type { ActivityKind } from '../engine/types';

export interface ImportOptions {
  activityWeightMode: 'nature' | 'equal';
  recurringCycles: boolean; // تقسيم الخطوات المتكررة إلى دورات شهرية
}

export interface PlannedActivity {
  title: string;
  kind: ActivityKind;
  weight: number;
  steps: {
    title: string;
    responsible: string | null;
    output: string | null;
    followup: string | null;
    weeks: number[];
    intensities: Record<number, number>;
    weight: number;
    isCore: boolean;
    substeps: { title: string; weight: number }[];
  }[];
}

/** يبني الهيكل المقترح (أنشطة/خطوات/أوزان/دورات) من ورقة مستوردة — دون كتابة */
export function buildPlanProposal(activities: ParsedActivity[], quarter: number, options: ImportOptions): PlannedActivity[] {
  const kinds = activities.map((a) => classifyActivity(a.title, a.steps.map((s) => s.title)));
  const aw =
    options.activityWeightMode === 'equal'
      ? suggestActivityWeightsEqual(activities.length)
      : suggestActivityWeightsByNature(activities.map((a, i) => ({ kind: kinds[i], steps: a.steps })));
  return activities.map((a, i) => {
    const sw = suggestStepWeights(kinds[i], a.steps);
    return {
      title: a.title,
      kind: kinds[i],
      weight: aw[i],
      steps: a.steps.map((s, j) => ({
        title: s.title,
        responsible: s.responsible,
        output: s.output,
        followup: s.followup,
        weeks: s.weeks,
        intensities: s.intensities,
        weight: sw.weights[j],
        isCore: j === sw.coreIndex,
        substeps: options.recurringCycles && kinds[i] === 'recurring' ? suggestCycleSubsteps(s.weeks, quarter) : [],
      })),
    };
  });
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** إنشاء خطة مسودة جديدة من المقترح */
export async function createPlanFromProposal(
  sb: SupabaseClient,
  input: { year: number; quarter: number; departmentId: string; title?: string; importId?: string | null; proposal: PlannedActivity[] },
): Promise<string> {
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id ?? null;

  const existing = await sb.from('op_plans').select('id,status').eq('year', input.year).eq('quarter', input.quarter).eq('department_id', input.departmentId).maybeSingle();
  if (existing.data) throw new Error('توجد خطة لهذه الإدارة في هذا الربع؛ استخدم إعادة الاستيراد للمقارنة');

  const plan = check(
    await sb
      .from('op_plans')
      .insert({ year: input.year, quarter: input.quarter, department_id: input.departmentId, title: input.title ?? null, created_by: uid })
      .select('id')
      .single(),
    'إنشاء الخطة',
  ) as { id: string };

  await insertActivities(sb, plan.id, input.proposal, 1);
  if (input.importId) {
    await sb.from('plan_imports').update({ applied_at: new Date().toISOString(), applied_plan_ids: [plan.id] }).eq('id', input.importId);
  }
  return plan.id;
}

async function insertActivities(sb: SupabaseClient, planId: string, proposal: PlannedActivity[], startSeq: number) {
  if (!proposal.length) return;
  const acts = check(
    await sb
      .from('activities')
      .insert(proposal.map((a, i) => ({ plan_id: planId, seq: startSeq + i, title: a.title, kind: a.kind, weight: a.weight, suggested_weight: a.weight })))
      .select('id,seq'),
    'إضافة الأنشطة',
  ) as { id: string; seq: number }[];
  const actId = new Map(acts.map((a) => [a.seq, a.id]));
  const stepRows = proposal.flatMap((a, i) =>
    a.steps.map((s, j) => ({
      activity_id: actId.get(startSeq + i)!,
      plan_id: planId,
      seq: j + 1,
      title: s.title,
      responsible_text: s.responsible,
      output: s.output,
      weight: s.weight,
      suggested_weight: s.weight,
      is_core: s.isCore,
      import_followup: s.followup,
    })),
  );
  const steps = check(await sb.from('steps').insert(stepRows).select('id,activity_id,seq'), 'إضافة الخطوات') as {
    id: string;
    activity_id: string;
    seq: number;
  }[];
  const stepId = (actIdx: number, seq: number) => steps.find((s) => s.activity_id === actId.get(startSeq + actIdx) && s.seq === seq)!.id;

  const weekRows = proposal.flatMap((a, i) =>
    a.steps.flatMap((s, j) => s.weeks.map((w) => ({ step_id: stepId(i, j + 1), week_index: w, intensity: s.intensities[w] ?? null }))),
  );
  if (weekRows.length) check(await sb.from('step_weeks').insert(weekRows), 'إضافة الجدولة');

  const subRows = proposal.flatMap((a, i) =>
    a.steps.flatMap((s, j) => s.substeps.map((ss, k) => ({ step_id: stepId(i, j + 1), title: ss.title, weight: ss.weight, sort_order: k + 1 }))),
  );
  if (subRows.length) check(await sb.from('substeps').insert(subRows), 'إضافة المراحل الفرعية');
}

// ---------------------------------------------------------------------
// إعادة الاستيراد
// ---------------------------------------------------------------------

export interface ReimportDecisions {
  applyAdded: boolean;
  applyChanged: boolean;
  removeMissing: boolean; // حذف/أرشفة ما لم يعد في الملف (لا يشمل ما فيه إنجاز)
}

/**
 * - خطة مسودة/معادة: تعديل مباشر (إضافة، تحديث، حذف ما لا إنجاز فيه) مع إعادة موازنة الأوزان لتساوي 100.
 * - خطة معتمدة: تحديث النصوص مباشرة، وما عدا ذلك يرسل «طلب تعديل» للمدير التنفيذي.
 */
export async function applyReimport(
  sb: SupabaseClient,
  planId: string,
  diff: PlanDiff,
  quarter: number,
  decisions: ReimportDecisions,
  options: ImportOptions,
): Promise<{ mode: 'direct' | 'change_request'; requestId?: string; applied: number }> {
  const plan = check(await sb.from('op_plans').select('id,status').eq('id', planId).single(), 'قراءة الخطة') as { id: string; status: string };
  const editable = plan.status === 'draft' || plan.status === 'returned';
  let applied = 0;

  // الأوزان الحالية
  const acts = check(await sb.from('activities').select('id,weight,seq,steps(id,weight,is_archived)').eq('plan_id', planId).eq('is_archived', false), 'قراءة الأنشطة') as {
    id: string;
    weight: number;
    seq: number;
    steps: { id: string; weight: number; is_archived: boolean }[];
  }[];

  const addedActs = decisions.applyAdded ? diff.activities.filter((a) => a.kind === 'added' && a.parsed) : [];
  const proposalNew = buildPlanProposal(addedActs.map((a) => a.parsed!), quarter, options);
  const removedActs = decisions.removeMissing ? diff.activities.filter((a) => a.kind === 'removed' && !a.hasProgress && a.existingId) : [];
  const removedStepIds = decisions.removeMissing
    ? diff.activities.filter((a) => a.kind === 'matched').flatMap((a) => a.steps.filter((s) => s.kind === 'removed' && !s.hasProgress).map((s) => s.existingId!))
    : [];
  const addedSteps = decisions.applyAdded
    ? diff.activities.filter((a) => a.kind === 'matched').flatMap((a) => a.steps.filter((s) => s.kind === 'added' && s.parsed).map((s) => ({ activityId: a.existingId!, step: s.parsed! })))
    : [];
  const changed = decisions.applyChanged ? diff.activities.flatMap((a) => a.steps.filter((s) => s.kind === 'changed' && s.existingId)) : [];

  // إعادة موازنة أوزان الأنشطة: الجديد يأخذ وزنه المقترح وتصغر الأنشطة القائمة تناسبيًا
  const keptActs = acts.filter((a) => !removedActs.some((r) => r.existingId === a.id));
  let actWeightUpdates: { id: string; weight: number }[] = [];
  if (proposalNew.length || removedActs.length) {
    const total = keptActs.length + proposalNew.length;
    const newShare = proposalNew.length ? 100 / total : 0;
    const keptSum = keptActs.reduce((s, a) => s + (Number(a.weight) || 0), 0) || 1;
    const remaining = 100 - newShare * proposalNew.length;
    const raw = [...keptActs.map((a) => ((Number(a.weight) || 0) / keptSum) * remaining), ...proposalNew.map(() => newShare)];
    const ws = normalizeTo100(raw);
    actWeightUpdates = keptActs.map((a, i) => ({ id: a.id, weight: ws[i] }));
    proposalNew.forEach((p, i) => (p.weight = ws[keptActs.length + i]));
  }

  // إعادة موازنة أوزان الخطوات داخل الأنشطة المعدلة
  const stepWeightUpdates: { id: string; weight: number }[] = [];
  const newStepWeights = new Map<string, number[]>();
  const touched = new Set([...addedSteps.map((x) => x.activityId), ...acts.filter((a) => a.steps.some((s) => removedStepIds.includes(s.id))).map((a) => a.id)]);
  for (const actId of touched) {
    const act = acts.find((a) => a.id === actId);
    if (!act) continue;
    const kept = act.steps.filter((s) => !s.is_archived && !removedStepIds.includes(s.id));
    const adds = addedSteps.filter((x) => x.activityId === actId);
    const n = kept.length + adds.length;
    const ws = normalizeTo100([...kept.map((s) => Number(s.weight) || 0), ...adds.map(() => 100 / Math.max(1, n))]);
    kept.forEach((s, i) => stepWeightUpdates.push({ id: s.id, weight: ws[i] }));
    newStepWeights.set(actId, ws.slice(kept.length));
  }

  if (editable) {
    for (const s of changed) {
      const p = s.parsed!;
      const upd: Record<string, unknown> = {};
      for (const c of s.changes) {
        if (c.field === 'responsible') upd.responsible_text = p.responsible;
        if (c.field === 'output') upd.output = p.output;
      }
      if (Object.keys(upd).length) check(await sb.from('steps').update(upd).eq('id', s.existingId!), 'تحديث خطوة');
      if (s.changes.some((c) => c.field === 'weeks')) {
        check(await sb.from('step_weeks').delete().eq('step_id', s.existingId!), 'تحديث الجدولة');
        if (p.weeks.length) check(await sb.from('step_weeks').insert(p.weeks.map((w) => ({ step_id: s.existingId!, week_index: w, intensity: p.intensities[w] ?? null }))), 'تحديث الجدولة');
      }
      applied++;
    }
    if (removedStepIds.length) {
      check(await sb.from('steps').delete().in('id', removedStepIds), 'حذف خطوات');
      applied += removedStepIds.length;
    }
    for (const r of removedActs) {
      check(await sb.from('activities').delete().eq('id', r.existingId!), 'حذف نشاط');
      applied++;
    }
    for (const u of stepWeightUpdates) check(await sb.from('steps').update({ weight: u.weight }).eq('id', u.id), 'موازنة الأوزان');
    for (const [actId, ws] of newStepWeights) {
      const adds = addedSteps.filter((x) => x.activityId === actId);
      const maxSeq = check(await sb.from('steps').select('seq').eq('activity_id', actId).order('seq', { ascending: false }).limit(1), 'ترتيب') as { seq: number }[];
      let seq = (maxSeq[0]?.seq ?? 0) + 1;
      for (const [i, x] of adds.entries()) {
        const row = check(
          await sb
            .from('steps')
            .insert({ activity_id: actId, plan_id: planId, seq: seq++, title: x.step.title, responsible_text: x.step.responsible, output: x.step.output, weight: ws[i], import_followup: x.step.followup })
            .select('id')
            .single(),
          'إضافة خطوة',
        ) as { id: string };
        if (x.step.weeks.length) check(await sb.from('step_weeks').insert(x.step.weeks.map((w) => ({ step_id: row.id, week_index: w, intensity: x.step.intensities[w] ?? null }))), 'جدولة');
        applied++;
      }
    }
    for (const u of actWeightUpdates) check(await sb.from('activities').update({ weight: u.weight }).eq('id', u.id), 'موازنة الأنشطة');
    const maxActSeq = Math.max(0, ...acts.map((a) => a.seq));
    await insertActivities(sb, planId, proposalNew, maxActSeq + 1);
    applied += proposalNew.length;
    return { mode: 'direct', applied };
  }

  // خطة معتمدة: النصوص مباشرة، والباقي طلب تعديل
  const texts: { step_id: string; responsible_text?: string | null; output?: string | null }[] = [];
  const weeks: { step_id: string; weeks: number[] }[] = [];
  for (const s of changed) {
    const p = s.parsed!;
    const t: (typeof texts)[number] = { step_id: s.existingId! };
    for (const c of s.changes) {
      if (c.field === 'responsible') t.responsible_text = p.responsible;
      if (c.field === 'output') t.output = p.output;
      if (c.field === 'weeks') weeks.push({ step_id: s.existingId!, weeks: p.weeks });
    }
    if (t.responsible_text !== undefined || t.output !== undefined) {
      const upd: Record<string, unknown> = {};
      if (t.responsible_text !== undefined) upd.responsible_text = t.responsible_text;
      if (t.output !== undefined) upd.output = t.output;
      check(await sb.from('steps').update(upd).eq('id', s.existingId!), 'تحديث النصوص');
      applied++;
    }
  }
  const payload = {
    activities: actWeightUpdates,
    steps: stepWeightUpdates,
    weeks,
    add_steps: [...newStepWeights.entries()].flatMap(([actId, ws]) =>
      addedSteps.filter((x) => x.activityId === actId).map((x, i) => ({ activity_id: actId, title: x.step.title, responsible_text: x.step.responsible, output: x.step.output, weight: ws[i], weeks: x.step.weeks })),
    ),
    add_activities: proposalNew.map((a) => ({
      title: a.title,
      kind: a.kind,
      weight: a.weight,
      steps: a.steps.map((s) => ({ title: s.title, responsible_text: s.responsible, output: s.output, weight: s.weight, is_core: s.isCore, weeks: s.weeks })),
    })),
    archive_steps: removedStepIds,
    archive_activities: removedActs.map((r) => r.existingId),
  };
  const hasStructural =
    payload.weeks.length || payload.add_steps.length || payload.add_activities.length || payload.archive_steps.length || payload.archive_activities.length;
  if (!hasStructural) return { mode: 'direct', applied };
  const { data, error } = await sb.rpc('request_plan_change', {
    p_plan: planId,
    p_kind: 'structure',
    p_payload: payload,
    p_reason: 'إعادة استيراد نسخة محدثة من ملف الخطة',
  });
  if (error) throw new Error('طلب التعديل: ' + error.message);
  return { mode: 'change_request', requestId: data as string, applied };
}
