// تحميل حقائق الإنجاز من قاعدة البيانات وتحويلها لمدخلات المحرك
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateOrg, todayISO } from '../engine/progress';
import type { ActivityKind, DeptWeight, OrgEval, PlanFact, PlanStatus, StepStatus, WeekBoundary } from '../engine/types';

interface FactRow {
  department_id: string;
  plan_id: string;
  quarter: number;
  plan_status: PlanStatus;
  plan_version: number;
  activity_id: string;
  activity_weight: number;
  activity_kind: ActivityKind;
  step_id: string | null;
  step_weight: number | null;
  step_progress: number | null;
  step_status: StepStatus | null;
  weeks: number[];
  last_update_at: string | null;
  actual_end: string | null;
}

export interface YearProgress {
  year: number;
  weights: DeptWeight[];
  weightsVersion: number | null;
  plans: PlanFact[];
  boundaries: Record<number, WeekBoundary[]>;
}

export async function loadYearProgress(sb: SupabaseClient, year: number): Promise<YearProgress> {
  const [facts, weights, weeks] = await Promise.all([
    sb.rpc('get_progress_facts', { p_year: year, p_quarter: null }),
    sb.rpc('get_dept_weights', { p_year: year }),
    sb.from('quarter_weeks').select('*').eq('year', year).order('quarter').order('week_index'),
  ]);
  if (facts.error) throw new Error(facts.error.message);
  if (weights.error) throw new Error(weights.error.message);
  if (weeks.error) throw new Error(weeks.error.message);

  const plans = new Map<string, PlanFact>();
  for (const r of (facts.data ?? []) as FactRow[]) {
    let p = plans.get(r.plan_id);
    if (!p) {
      p = { id: r.plan_id, departmentId: r.department_id, quarter: r.quarter, status: r.plan_status, version: r.plan_version, activities: [] };
      plans.set(r.plan_id, p);
    }
    let a = p.activities.find((x) => x.id === r.activity_id);
    if (!a) {
      a = { id: r.activity_id, weight: Number(r.activity_weight), kind: r.activity_kind, steps: [] };
      p.activities.push(a);
    }
    if (r.step_id) {
      a.steps.push({
        id: r.step_id,
        weight: Number(r.step_weight),
        progress: Number(r.step_progress),
        status: r.step_status!,
        weeks: r.weeks ?? [],
        lastUpdateAt: r.last_update_at,
        actualEnd: r.actual_end,
      });
    }
  }

  const boundaries: Record<number, WeekBoundary[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const w of (weeks.data ?? []) as { quarter: number; week_index: number; month: number; week_of_month: number; start_date: string; end_date: string }[]) {
    boundaries[w.quarter].push({ weekIndex: w.week_index, month: w.month, weekOfMonth: w.week_of_month, start: w.start_date, end: w.end_date });
  }

  const wrows = (weights.data ?? []) as { department_id: string; weight: number; set_version: number }[];
  return {
    year,
    weights: wrows.map((w) => ({ departmentId: w.department_id, weight: Number(w.weight) })),
    weightsVersion: wrows[0]?.set_version ?? null,
    plans: [...plans.values()],
    boundaries,
  };
}

export function quarterOf(dateISO: string): number {
  return Math.ceil(Number(dateISO.slice(5, 7)) / 3);
}

export function evaluateQuarter(yp: YearProgress, quarter: number, opts?: { asOf?: string; staleAfterDays?: number }): OrgEval {
  const asOf = opts?.asOf ?? todayISO();
  // للأرباع المنتهية يقيم الإنجاز كما هو في نهاية الربع (المخطط = 100)
  const b = yp.boundaries[quarter] ?? [];
  const end = b.at(-1)?.end;
  const effective = end && asOf > end ? end : asOf;
  return evaluateOrg(
    yp.weights,
    yp.plans.filter((p) => p.quarter === quarter),
    b,
    { asOf: effective, staleAfterDays: opts?.staleAfterDays },
  );
}
