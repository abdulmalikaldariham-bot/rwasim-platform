import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateKpi, type KpiEval, type KpiDirection, type KpiType } from '../engine/kpi';

export interface KpiRow {
  id: string;
  plan_id: string;
  goal_id: string | null;
  code: string | null;
  name: string;
  definition: string | null;
  calc_method: string | null;
  unit: string | null;
  kpi_type: KpiType;
  direction: KpiDirection;
  baseline: number | null;
  annual_target: number | null;
  department_id: string | null;
  frequency: string;
  data_source: string | null;
  actual_mode: 'manual' | 'derived_count';
  sort_order: number;
}

export interface KpiView extends KpiRow {
  periodTargets: Record<number, number>;
  actual: number | null;
  measuredOn: string | null;
  evaluation: KpiEval;
  linkedActivities: number;
}

export interface ExecPlanView {
  plan: { id: string; year: number; title: string; status: string; approved_at: string | null } | null;
  axes: { id: string; title: string; goals: { id: string; title: string; description: string | null; kpis: KpiView[] }[] }[];
  kpis: KpiView[];
}

export async function loadExecPlan(sb: SupabaseClient, year: number, quarter: number): Promise<ExecPlanView> {
  const { data: plan } = await sb.from('exec_plans').select('id,year,title,status,approved_at').eq('year', year).maybeSingle();
  if (!plan) return { plan: null, axes: [], kpis: [] };
  const [axes, goals, kpis, targets, meas, links] = await Promise.all([
    sb.from('exec_axes').select('*').eq('plan_id', plan.id).order('sort_order'),
    sb.from('exec_goals').select('*').eq('plan_id', plan.id).order('sort_order'),
    sb.from('kpis').select('*').eq('plan_id', plan.id).order('sort_order'),
    sb.from('kpi_period_targets').select('*'),
    sb.from('kpi_measurements').select('kpi_id,value,measured_on,recorded_at').order('measured_on', { ascending: false }).order('recorded_at', { ascending: false }),
    sb.from('activities').select('kpi_id').not('kpi_id', 'is', null),
  ]);
  const derived = new Map<string, number>();
  const kRows = (kpis.data ?? []) as KpiRow[];
  await Promise.all(
    kRows
      .filter((k) => k.actual_mode === 'derived_count')
      .map(async (k) => {
        const { data } = await sb.rpc('kpi_derived_value', { p_kpi: k.id });
        derived.set(k.id, Number(data ?? 0));
      }),
  );
  const views: KpiView[] = kRows.map((k) => {
    const pt: Record<number, number> = {};
    for (const t of (targets.data ?? []).filter((t: { kpi_id: string }) => t.kpi_id === k.id)) pt[t.quarter] = Number(t.target);
    const last = (meas.data ?? []).find((m: { kpi_id: string }) => m.kpi_id === k.id) as { value: number; measured_on: string } | undefined;
    const actual = k.actual_mode === 'derived_count' ? derived.get(k.id) ?? null : last ? Number(last.value) : null;
    return {
      ...k,
      baseline: k.baseline === null ? null : Number(k.baseline),
      annual_target: k.annual_target === null ? null : Number(k.annual_target),
      periodTargets: pt,
      actual,
      measuredOn: k.actual_mode === 'derived_count' ? null : last?.measured_on ?? null,
      linkedActivities: (links.data ?? []).filter((l: { kpi_id: string }) => l.kpi_id === k.id).length,
      evaluation: evaluateKpi(
        {
          kpiType: k.kpi_type,
          direction: k.direction,
          baseline: k.baseline === null ? null : Number(k.baseline),
          annualTarget: k.annual_target === null ? null : Number(k.annual_target),
          periodTargets: pt,
          actual,
        },
        quarter,
      ),
    };
  });
  const axesView = (axes.data ?? []).map((a: { id: string; title: string }) => ({
    id: a.id,
    title: a.title,
    goals: (goals.data ?? [])
      .filter((g: { axis_id: string }) => g.axis_id === a.id)
      .map((g: { id: string; title: string; description: string | null }) => ({ ...g, kpis: views.filter((k) => k.goal_id === g.id) })),
  }));
  const orphan = views.filter((k) => !k.goal_id);
  if (orphan.length) axesView.push({ id: 'none', title: 'مؤشرات غير مصنفة', goals: [{ id: 'none', title: 'دون هدف', description: null, kpis: orphan }] });
  return { plan, axes: axesView, kpis: views };
}
