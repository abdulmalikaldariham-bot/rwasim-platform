// =====================================================================
// بناء نموذج «لوحة العرض الخارجية» من مخرجات share_dashboard.
// يُنفذ على الخادم فقط؛ المتصفح يتلقى الأرقام النهائية دون الحقائق الخام.
// =====================================================================
import 'server-only';
import { buildYearProgress, evaluateQuarter, quarterOf, type FactRow, type WeekRow } from '../data/progress';
import { orgCurve } from '../data/common';
import { deptCounts, emptyCounts, orgCounts, type WorkCounts } from '../engine/counts';
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

export type QuarterState = 'done' | 'current' | 'upcoming';

/** عرض «السنة كاملة»: إنجاز كل ربع، والسنوي = متوسط الأرباع حتى الربع الحالي */
export interface ShareYear {
  /** آخر ربع داخل الاحتساب (0 = لم تبدأ السنة بعد) */
  upto: number;
  progress: number | null;
  planned: number | null;
  /** عدد الأرباع التي دخلت المتوسط فعلًا (لها خطط معتمدة) */
  counted: number;
  quarters: { quarter: number; state: QuarterState; hasPlans: boolean; computable: boolean; progress: number | null; planned: number | null }[];
  depts: { id: string; name: string; short: string; quarters: (number | null)[]; progress: number | null }[];
  counts: WorkCounts;
}

export interface ShareView {
  ok: true;
  name: string;
  year: number;
  quarter: number;
  years: number[];
  today: string;
  generatedAt: string;
  settings: { allowPeriodSwitch: boolean; showOperational: boolean; showExecutive: boolean; showActivities: boolean; showYear: boolean; refreshSeconds: number };
  ops: null | {
    hasPlans: boolean;
    computable: boolean;
    progress: number | null;
    partialProgress: number | null;
    planned: number | null;
    curve: CurvePoint[];
    counts: WorkCounts;
    depts: ShareDept[];
    year: ShareYear | null;
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
    showYear: !!st.show_year,
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
      year: settings.showYear ? buildYear(yp, year, today, deptsRaw) : null,
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

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

/** إنجاز السنة: كل ربع يُقيّم كما هو (المنتهي في نهايته)، والسنوي متوسط الأرباع حتى الربع الحالي التي لها خطط معتمدة */
function buildYear(yp: ReturnType<typeof buildYearProgress>, year: number, today: string, deptsRaw: { id: string; name: string; short: string }[]): ShareYear {
  const ty = Number(today.slice(0, 4));
  const cq = quarterOf(today);
  const upto = year < ty ? 4 : year > ty ? 0 : cq;
  const evals = [1, 2, 3, 4].map((q) => evaluateQuarter(yp, q, { asOf: today }));
  const approved = (q: number) => yp.plans.some((p) => p.quarter === q && (p.status === 'approved' || p.status === 'archived'));

  const quarters = evals.map((e, i) => {
    const q = i + 1;
    const hasPlans = approved(q);
    const state: QuarterState = q < upto || (q === upto && year < ty) ? 'done' : q === upto ? 'current' : 'upcoming';
    return {
      quarter: q,
      state,
      hasPlans,
      computable: e.computable,
      progress: hasPlans ? (e.computable ? e.progress : e.partialProgress) : null,
      planned: hasPlans ? e.planned : null,
    };
  });
  const inScope = quarters.filter((q) => q.quarter <= upto && q.progress !== null);

  const counts = emptyCounts();
  for (let q = 1; q <= upto; q++) {
    const c = orgCounts(evals[q - 1], yp.plans.filter((p) => p.quarter === q));
    for (const k of Object.keys(counts.works) as (keyof WorkCounts['works'])[]) counts.works[k] += c.works[k];
    for (const k of Object.keys(counts.tasks) as (keyof WorkCounts['tasks'])[]) counts.tasks[k] += c.tasks[k];
  }

  const depts = yp.weights.map((w) => {
    const info = deptsRaw.find((x) => x.id === w.departmentId);
    const qs = evals.map((e) => e.departments.find((d) => d.departmentId === w.departmentId)?.progress ?? null);
    return {
      id: w.departmentId,
      name: info?.name ?? '—',
      short: info?.short ?? info?.name ?? '—',
      quarters: qs,
      progress: avg(qs.slice(0, upto)),
    };
  });

  return {
    upto,
    progress: avg(inScope.map((q) => q.progress)),
    planned: avg(inScope.map((q) => q.planned)),
    counted: inScope.length,
    quarters,
    depts,
    counts,
  };
}
