import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateActivity, todayISO } from '../engine/progress';
import type { ActivityEval, ActivityKind, PlanStatus, StepStatus, WeekBoundary } from '../engine/types';

export interface StepRow {
  id: string;
  activity_id: string;
  plan_id: string;
  seq: number;
  title: string;
  responsible_text: string | null;
  assignee_id: string | null;
  output: string | null;
  weight: number;
  suggested_weight: number | null;
  is_core: boolean;
  status: StepStatus;
  progress: number;
  actual_start: string | null;
  actual_end: string | null;
  import_followup: string | null;
  import_note: string | null;
  last_update_at: string | null;
  weeks: number[];
  intensities: Record<number, number>;
  substeps: { id: string; title: string; weight: number; sort_order: number; is_done: boolean }[];
  evidenceCount: number;
  /** اسم المسؤول الرئيسي أو ملخص المكلفين */
  assigneeName: string | null;
  start_date: string | null;
  end_date: string | null;
  dates_source: 'weeks' | 'manual' | 'none';
  output_achieved: string | null;
  output_policy: 'none' | 'description' | 'evidence';
  assignment_mode: 'shared' | 'individual';
  completion_threshold: number;
  assign_all: boolean;
  assignees: { user_id: string; name: string; is_lead: boolean; status: StepStatus; done_at: string | null; note: string | null }[];
}

export interface ActivityRow {
  id: string;
  plan_id: string;
  seq: number;
  title: string;
  description: string | null;
  kind: ActivityKind;
  kpi_id: string | null;
  weight: number;
  suggested_weight: number | null;
  steps: StepRow[];
  eval: ActivityEval;
}

export interface PlanRow {
  id: string;
  year: number;
  quarter: number;
  department_id: string;
  title: string | null;
  status: PlanStatus;
  version: number;
  return_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  updated_at: string;
}

export function assigneeSummary(list: { name: string; is_lead: boolean }[], all = false): string | null {
  if (!list.length) return null;
  if (all) return `جميع موظفي الإدارة (${list.length})`;
  if (list.length === 1) return list[0].name;
  const lead = list.find((a) => a.is_lead) ?? list[0];
  return `${lead.name} و${list.length - 1} ${list.length - 1 === 1 ? 'آخر' : list.length - 1 <= 10 ? 'آخرين' : 'آخرين'}`;
}

/** تحويل صف المهمة إلى مدخلات المحرك */
export function stepFact(s: StepRow) {
  return {
    id: s.id,
    weight: s.weight,
    progress: s.progress,
    status: s.status,
    weeks: s.weeks,
    lastUpdateAt: s.last_update_at,
    actualEnd: s.actual_end,
    startDate: s.start_date,
    endDate: s.end_date,
    datesSource: s.dates_source,
  };
}

export async function getBoundaries(sb: SupabaseClient, year: number, quarter: number): Promise<WeekBoundary[]> {
  const { data } = await sb.from('quarter_weeks').select('*').eq('year', year).eq('quarter', quarter).order('week_index');
  return (data ?? []).map((w) => ({ weekIndex: w.week_index, month: w.month, weekOfMonth: w.week_of_month, start: w.start_date, end: w.end_date }));
}

const STEP_SELECT =
  'id,activity_id,plan_id,seq,title,responsible_text,assignee_id,output,weight,suggested_weight,is_core,status,progress,actual_start,actual_end,import_followup,import_note,last_update_at,start_date,end_date,dates_source,output_achieved,output_policy,assignment_mode,completion_threshold,assign_all,step_weeks(week_index,intensity),substeps(id,title,weight,sort_order,is_done),evidence(count),step_assignees(user_id,is_lead,status,done_at,note,person:profiles!step_assignees_user_id_fkey(full_name))';

 
 
function mapStep(s: any): StepRow {
  const assignees = ((s.step_assignees ?? []) as { user_id: string; is_lead: boolean; status: StepStatus; done_at: string | null; note: string | null; person?: { full_name: string } }[])
    .map((a) => ({ user_id: a.user_id, name: a.person?.full_name ?? '—', is_lead: a.is_lead, status: a.status, done_at: a.done_at, note: a.note }))
    .sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.name.localeCompare(b.name, 'ar'));
  const weeks = ((s.step_weeks ?? []) as { week_index: number; intensity: number | null }[]).sort((a, b) => a.week_index - b.week_index);
  return {
    ...s,
    weight: Number(s.weight),
    progress: Number(s.progress),
    weeks: weeks.map((w) => w.week_index),
    intensities: Object.fromEntries(weeks.filter((w) => w.intensity).map((w) => [w.week_index, w.intensity!])),
    substeps: ((s.substeps ?? []) as StepRow['substeps']).map((x) => ({ ...x, weight: Number(x.weight) })).sort((a, b) => a.sort_order - b.sort_order),
    evidenceCount: s.evidence?.[0]?.count ?? 0,
    completion_threshold: Number(s.completion_threshold ?? 100),
    assignees,
    assigneeName: assigneeSummary(assignees, !!s.assign_all),
  };
}

/** أنشطة خطة (أو خطط) مع خطواتها وتقييمها */
export async function loadActivities(
  sb: SupabaseClient,
  planIds: string[],
  boundariesByPlan: Record<string, WeekBoundary[]>,
  asOf = todayISO(),
): Promise<ActivityRow[]> {
  if (!planIds.length) return [];
  const [acts, steps] = await Promise.all([
    sb.from('activities').select('id,plan_id,seq,title,description,kind,kpi_id,weight,suggested_weight').in('plan_id', planIds).eq('is_archived', false).order('seq'),
    sb.from('steps').select(STEP_SELECT).in('plan_id', planIds).eq('is_archived', false).order('seq'),
  ]);
  if (acts.error) throw new Error(acts.error.message);
  if (steps.error) throw new Error(steps.error.message);
  const allSteps = (steps.data ?? []).map(mapStep);
  return (acts.data ?? []).map((a) => {
    const st = allSteps.filter((s) => s.activity_id === a.id);
    const b = boundariesByPlan[a.plan_id] ?? [];
    const end = b.at(-1)?.end;
    return {
      ...a,
      weight: Number(a.weight),
      steps: st,
      eval: evaluateActivity(
        {
          id: a.id,
          weight: Number(a.weight),
          steps: st.map(stepFact),
        },
        b,
        end && asOf > end ? end : asOf,
      ),
    } as ActivityRow;
  });
}

export async function loadPlan(sb: SupabaseClient, planId: string) {
  const { data: plan } = await sb.from('op_plans').select('*').eq('id', planId).maybeSingle();
  if (!plan) return null;
  const boundaries = await getBoundaries(sb, plan.year, plan.quarter);
  const activities = await loadActivities(sb, [plan.id], { [plan.id]: boundaries });
  return { plan: plan as PlanRow, boundaries, activities };
}

export async function loadStepsOnly(sb: SupabaseClient, filter: { assignee?: string; planIds?: string[]; ids?: string[] }) {
  let ids = filter.ids;
  if (filter.assignee) {
    const { data: mine } = await sb.from('step_assignees').select('step_id').eq('user_id', filter.assignee);
    ids = (mine ?? []).map((m) => m.step_id);
    if (!ids.length) return [];
  }
  let q = sb.from('steps').select(STEP_SELECT + ',activities(title,plan_id,kind),op_plans(year,quarter,department_id,status)').eq('is_archived', false);
  if (ids) q = q.in('id', ids);
  if (filter.planIds) q = q.in('plan_id', filter.planIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
   
  return (data ?? []).map((s: any) => ({
    ...mapStep(s),
    activityTitle: s.activities?.title as string,
    activityKind: s.activities?.kind as ActivityKind,
    plan: s.op_plans as { year: number; quarter: number; department_id: string; status: PlanStatus },
  }));
}
