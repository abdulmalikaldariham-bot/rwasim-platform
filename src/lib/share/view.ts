// =====================================================================
// بناء نموذج «لوحة العرض الخارجية» من مخرجات share_dashboard.
// يُنفذ على الخادم فقط؛ المتصفح يتلقى الأرقام النهائية دون الحقائق الخام.
// =====================================================================
import 'server-only';
import { buildYearProgress, evaluateQuarter, type FactRow, type WeekRow } from '../data/progress';
import { orgCurve } from '../data/common';
import { deptCounts, orgCounts, type WorkCounts } from '../engine/counts';
import { evaluateKpi, type KpiDirection, type KpiStatus, type KpiType } from '../engine/kpi';
import type { ActivityKind, ActivityState, DataState } from '../engine/types';
import type { CurvePoint } from '../engine/progress';

export type ShareFailure = { ok: false; reason: 'invalid' | 'expired' | 'code_required' | 'code_invalid' | 'locked' | 'error'; name?: string };

export interface ShareDept {
  id: string;
  name: string;
  short: string;
  progress: number | null;
  planned: number | null;
  dataState: DataState;
  counts: WorkCounts;
  activities?: { id: string; title: string; kind: ActivityKind | undefined; progress: number; planned: number; state: ActivityState; tasksTotal: number; tasksDone: number; tasksLate: number }[];
}

export interface ShareKpi {
  id: string;
  name: string;
  unit: string | null;
  kpiType: KpiType;
  goal: string | null;
  axis: string | null;
  target: number | null;
  expected: number | null;
  actual: number | null;
  achievement: number | null;
  status: KpiStatus;
}

export interface ShareView {
  ok: true;
  name: string;
  year: number;
  quarter: number;
  years: number[];
  today: string;
  generatedAt: string;
  settings: { allowPeriodSwitch: boolean; showOperational: boolean; showExecutive: boolean; showActivities: boolean; refreshSeconds: number };
  ops: null | {
    hasPlans: boolean;
    computable: boolean;
    progress: number | null;
    partialProgress: number | null;
    planned: number | null;
    curve: CurvePoint[];
    counts: WorkCounts;
    depts: ShareDept[];
  };
  exec: null | {
    hasPlan: boolean;
    counts: { total: number; achieved: number; onTrack: number; attention: number; noData: number };
    goals: { id: string; title: string; axis: string | null; achievement: number | null; kpis: number }[];
    kpis: ShareKpi[];
  };
}

 
export function buildShareView(raw: any): ShareView | ShareFailure {
  if (!raw || raw.ok !== true) return { ok: false, reason: raw?.reason ?? 'error', name: raw?.name };
  const year = Number(raw.year);
  const quarter = Number(raw.quarter);
  const today = String(raw.today);
  const st = raw.settings ?? {};
  const settings = {
    allowPeriodSwitch: !!st.allow_period_switch,
    showOperational: !!st.show_operational,
    showExecutive: !!st.show_executive,
    showActivities: !!st.show_activities,
    refreshSeconds: Number(st.refresh_seconds) || 300,
  };

  let ops: ShareView['ops'] = null;
  if (settings.showOperational) {
    const facts: FactRow[] = (raw.facts ?? []).map((f: any) => ({ ...f, plan_status: f.status, plan_version: 1, weeks: f.weeks ?? [] }));
    const titles = new Map<string, string>((raw.facts ?? []).filter((f: any) => f.activity_title).map((f: any) => [f.activity_id, f.activity_title]));
    const yp = buildYearProgress(year, facts, raw.weights ?? [], (raw.weeks ?? []) as WeekRow[]);
    const org = evaluateQuarter(yp, quarter, { asOf: today });
    const plans = yp.plans.filter((p) => p.quarter === quarter);
    const deptsRaw: { id: string; name: string; short: string }[] = raw.departments ?? [];
    const depts: ShareDept[] = org.departments.map((d) => {
      const info = deptsRaw.find((x) => x.id === d.departmentId);
      const plan = plans.find((p) => p.id === d.planId);
      return {
        id: d.departmentId,
        name: info?.name ?? '—',
        short: info?.short ?? info?.name ?? '—',
        progress: d.progress,
        planned: d.planned,
        dataState: d.dataState,
        counts: deptCounts(d, plan),
        activities: settings.showActivities
          ? d.activities.map((a) => {
              const fa = plan?.activities.find((x) => x.id === a.id);
              return {
                id: a.id,
                title: titles.get(a.id) ?? '—',
                kind: fa?.kind,
                progress: a.progress,
                planned: a.planned,
                state: a.state,
                tasksTotal: a.stepsTotal,
                tasksDone: a.stepsCompleted,
                tasksLate: a.lateSteps,
              };
            })
          : undefined,
      };
    });
    ops = {
      hasPlans: plans.length > 0,
      computable: org.computable,
      progress: org.progress,
      partialProgress: org.partialProgress,
      planned: org.planned,
      curve: orgCurve(yp, quarter, org, today),
      counts: orgCounts(org, plans),
      depts,
    };
  }

  let exec: ShareView['exec'] = null;
  if (settings.showExecutive) {
    const e = raw.exec;
    if (!e) {
      exec = { hasPlan: false, counts: { total: 0, achieved: 0, onTrack: 0, attention: 0, noData: 0 }, goals: [], kpis: [] };
    } else {
      const axes = new Map<string, string>((e.axes ?? []).map((a: any) => [a.id, a.title]));
      const axisOrder = new Map<string, number>((e.axes ?? []).map((a: any, i: number) => [a.id, i]));
      const sortedGoals = [...(e.goals ?? [])].sort((a: any, b: any) => (axisOrder.get(a.axis_id) ?? 99) - (axisOrder.get(b.axis_id) ?? 99));
      const goals = new Map<string, { title: string; axis: string | null }>(sortedGoals.map((g: any) => [g.id, { title: g.title, axis: axes.get(g.axis_id) ?? null }]));
      const kpis: ShareKpi[] = (e.kpis ?? []).map((k: any) => {
        const targets: Record<number, number> = {};
        for (const [q, v] of Object.entries(k.targets ?? {})) targets[Number(q)] = Number(v);
        const num = (v: any) => (v === null || v === undefined ? null : Number(v));
        const ev = evaluateKpi(
          { kpiType: k.kpi_type, direction: k.direction as KpiDirection, baseline: num(k.baseline), annualTarget: num(k.annual_target), periodTargets: targets, actual: num(k.actual) },
          quarter,
        );
        const g = k.goal_id ? goals.get(k.goal_id) : undefined;
        return {
          id: k.id,
          name: k.name,
          unit: k.unit,
          kpiType: k.kpi_type,
          goal: g?.title ?? null,
          axis: g?.axis ?? null,
          target: num(k.annual_target),
          expected: ev.expected,
          actual: num(k.actual),
          achievement: ev.achievement,
          status: ev.status,
        };
      });
      const by = (s: KpiStatus) => kpis.filter((k) => k.status === s).length;
      const goalList = [...goals.entries()].map(([id, g]) => {
        const ks = (e.kpis ?? []).filter((k: any) => k.goal_id === id).map((k: any) => kpis.find((x) => x.id === k.id)!);
        const vals = ks.map((k: ShareKpi) => k.achievement).filter((v: number | null): v is number => v !== null).map((v: number) => Math.min(100, Math.max(0, v)));
        return { id, title: g.title, axis: g.axis, kpis: ks.length, achievement: vals.length ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 10) / 10 : null };
      });
      exec = {
        hasPlan: true,
        counts: { total: kpis.length, achieved: by('achieved'), onTrack: by('on_track'), attention: by('at_risk') + by('off_track'), noData: by('no_data') + by('no_target') },
        goals: goalList,
        kpis: kpis.slice(0, Number(st.kpi_limit) || 9),
      };
    }
  }

  return {
    ok: true,
    name: String(raw.name),
    year,
    quarter,
    years: (raw.years ?? []).map(Number),
    today,
    generatedAt: String(raw.generated_at),
    settings,
    ops,
    exec,
  };
}
