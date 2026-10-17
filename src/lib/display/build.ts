// =====================================================================
// لوحة العرض الخارجية — بناء نموذج العرض من بيانات الرابط
// ---------------------------------------------------------------------
// المصدر الوحيد هو الدالة get_display_data (تتحقق من الرابط في قاعدة البيانات
// وتعيد أرقامًا معتمدة فقط). يُحتسب الإنجاز بالمحرك نفسه المستخدم داخل المنصة،
// والناتج لا يحمل أي معرّفات داخلية للمستخدمين أو ملاحظات أو ملفات.
// =====================================================================
import 'server-only';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { evaluateQuarter, type YearProgress } from '../data/progress';
import { orgCurve } from '../data/common';
import { evaluateKpi, type KpiDirection, type KpiStatus, type KpiType } from '../engine/kpi';
import type { ActivityKind, ActivityState, DataState, PlanFact, PlanStatus, StepStatus, WeekBoundary } from '../engine/types';
import type { CurvePoint } from '../engine/progress';

export type DisplayStatus = 'ok' | 'invalid' | 'expired' | 'locked' | 'code_required' | 'code_invalid' | 'error';

export interface DisplaySections {
  ops: boolean;
  departments: boolean;
  curve: boolean;
  exec: boolean;
  activity_titles: boolean;
}

export interface DisplayActivity {
  title: string | null;
  kind: ActivityKind | undefined;
  progress: number;
  planned: number;
  state: ActivityState;
  stepsTotal: number;
  stepsCompleted: number;
}

export interface DisplayDept {
  id: string;
  name: string;
  short: string;
  status: 'approved' | 'not_approved' | 'no_plan';
  progress: number | null;
  planned: number | null;
  dataState: DataState;
  units: number;
  unitsCompleted: number;
  unitsInProgress: number;
  unitsLate: number;
  steps: number;
  stepsCompleted: number;
  stepsLate: number;
  activities: DisplayActivity[];
}

export interface DisplayKpi {
  id: string;
  name: string;
  unit: string | null;
  kpiType: KpiType;
  direction: KpiDirection;
  target: number | null;
  actual: number | null;
  expected: number | null;
  achievement: number | null;
  status: KpiStatus;
  goalId: string | null;
  department: string | null;
  measuredOn: string | null;
}

export interface DisplayGoal {
  id: string;
  title: string;
  axis: string | null;
  progress: number | null;
  kpiCount: number;
  achieved: number;
}

export interface DisplayModel {
  status: 'ok';
  generatedAt: string;
  link: { name: string; refreshSeconds: number; sections: DisplaySections; allowNav: boolean; kpiLimit: number };
  period: { year: number; quarter: number; today: string };
  years: number[];
  orgName: string;
  ops: {
    progress: number | null;
    computable: boolean;
    partial: number | null;
    planned: number | null;
    missing: string[];
    counts: { units: number; projects: number; unitsCompleted: number; unitsInProgress: number; unitsLate: number; unitsNotStarted: number; steps: number; stepsCompleted: number; stepsInProgress: number; stepsLate: number };
    curve: CurvePoint[];
    quarters: { q: number; value: number | null; partial: boolean; hasPlans: boolean }[];
  };
  depts: DisplayDept[];
  exec: { title: string; goals: DisplayGoal[]; kpis: DisplayKpi[]; totalKpis: number } | null;
}

export type DisplayResult = DisplayModel | { status: Exclude<DisplayStatus, 'ok'>; until?: string };

type Raw = any;

const DEFAULT_SECTIONS: DisplaySections = { ops: true, departments: true, curve: true, exec: true, activity_titles: false };

function anonClient() {
  return createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadDisplay(token: string, opts: { code?: string | null; year?: number | null; quarter?: number | null } = {}): Promise<DisplayResult> {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) return { status: 'invalid' };
  const { data, error } = await anonClient().rpc('get_display_data', {
    p_token: token,
    p_code: opts.code ?? null,
    p_year: opts.year ?? null,
    p_quarter: opts.quarter ?? null,
  });
  if (error || !data) return { status: 'error' };
  const raw = data as Raw;
  if (raw.status !== 'ok') return { status: raw.status, until: raw.until };
  return buildModel(raw);
}

export function buildModel(raw: Raw): DisplayModel {
  const year: number = raw.period.year;
  const quarter: number = raw.period.quarter;
  const today: string = raw.period.today;
  const sections: DisplaySections = { ...DEFAULT_SECTIONS, ...(raw.link.sections ?? {}) };

  const boundaries: Record<number, WeekBoundary[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const w of raw.boundaries as Raw[]) {
    boundaries[w.quarter].push({ weekIndex: w.week_index, month: w.month, weekOfMonth: w.week_of_month, start: w.start_date, end: w.end_date });
  }
  const plans: PlanFact[] = (raw.plans as Raw[]).map((p) => ({
    id: p.id,
    departmentId: p.department_id,
    quarter: p.quarter,
    status: p.status as PlanStatus,
    activities: (p.activities as Raw[]).map((a) => ({
      id: a.id,
      weight: Number(a.weight),
      kind: a.kind as ActivityKind,
      steps: (a.steps as Raw[]).map((s) => ({
        id: s.id,
        weight: Number(s.weight),
        progress: Number(s.progress),
        status: s.status as StepStatus,
        weeks: s.weeks ?? [],
        lastUpdateAt: s.last_update_at,
        actualEnd: s.actual_end,
        plannedStart: s.planned_start,
        plannedEnd: s.planned_end,
      })),
    })),
  }));
  const titles = new Map<string, string | null>();
  for (const p of raw.plans as Raw[]) for (const a of p.activities as Raw[]) titles.set(a.id, a.title ?? null);

  const yp: YearProgress = {
    year,
    weights: (raw.weights as Raw[]).map((w) => ({ departmentId: w.department_id, weight: Number(w.weight) })),
    weightsVersion: null,
    plans,
    boundaries,
  };
  const org = evaluateQuarter(yp, quarter, { asOf: today });
  const curve = sections.curve ? orgCurve(yp, quarter, org, today) : [];
  const deptsRaw = raw.departments as Raw[];
  const statuses = raw.plan_statuses as Raw[];

  const depts: DisplayDept[] = org.departments.map((d, di) => {
    const info = deptsRaw.find((x) => x.id === d.departmentId);
    const st = statuses.find((x) => x.department_id === d.departmentId && x.quarter === quarter);
    const plan = plans.find((p) => p.departmentId === d.departmentId && p.quarter === quarter);
    return {
      id: `d${di + 1}`, // لا يُكشف المعرف الداخلي للإدارة
      name: info?.name ?? '—',
      short: info?.short_name ?? info?.name ?? '—',
      status: d.progress !== null ? 'approved' : st ? 'not_approved' : 'no_plan',
      progress: d.progress,
      planned: d.planned,
      dataState: d.dataState,
      units: d.activitiesTotal,
      unitsCompleted: d.activitiesCompleted,
      unitsInProgress: d.activitiesInProgress,
      unitsLate: d.activitiesLate + d.activitiesStalled,
      steps: d.stepsTotal,
      stepsCompleted: d.stepsCompleted,
      stepsLate: d.stepsLate,
      activities: d.activities.map((a, i) => ({
        title: sections.activity_titles ? titles.get(a.id) ?? null : null,
        kind: plan?.activities[i]?.kind ?? a.kind,
        progress: a.progress,
        planned: a.planned,
        state: a.state,
        stepsTotal: a.stepsTotal,
        stepsCompleted: a.stepsCompleted,
      })),
    };
  });

  const approved = org.departments.filter((d) => d.progress !== null);
  const sum = (f: (d: (typeof approved)[number]) => number) => approved.reduce((n, d) => n + f(d), 0);
  const counts = {
    units: sum((d) => d.activitiesTotal),
    projects: sum((d) => d.projectsTotal),
    unitsCompleted: sum((d) => d.activitiesCompleted),
    unitsInProgress: sum((d) => d.activitiesInProgress),
    unitsLate: sum((d) => d.activitiesLate + d.activitiesStalled),
    unitsNotStarted: sum((d) => d.activitiesNotStarted),
    steps: sum((d) => d.stepsTotal),
    stepsCompleted: sum((d) => d.stepsCompleted),
    stepsInProgress: sum((d) => d.stepsInProgress),
    stepsLate: sum((d) => d.stepsLate),
  };

  const quarters = [1, 2, 3, 4].map((q) => {
    const e = evaluateQuarter(yp, q, { asOf: today });
    return { q, value: e.computable ? e.progress : e.partialProgress, partial: !e.computable, hasPlans: (statuses as Raw[]).some((x) => x.quarter === q) };
  });

  let exec: DisplayModel['exec'] = null;
  if (sections.exec && raw.exec) {
    const kpisAll: DisplayKpi[] = (raw.exec.kpis as Raw[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((k) => {
        const targets: Record<number, number> = {};
        for (const [q, v] of Object.entries(k.targets ?? {})) targets[Number(q)] = Number(v);
        const actual = k.actual === null || k.actual === undefined ? null : Number(k.actual);
        const ev = evaluateKpi(
          {
            kpiType: k.kpi_type,
            direction: k.direction,
            baseline: k.baseline === null ? null : Number(k.baseline),
            annualTarget: k.annual_target === null ? null : Number(k.annual_target),
            periodTargets: targets,
            actual,
          },
          quarter,
        );
        return {
          id: `k${k.sort_order}`,
          name: k.name,
          unit: k.unit,
          kpiType: k.kpi_type,
          direction: k.direction,
          target: k.annual_target === null ? null : Number(k.annual_target),
          actual,
          expected: ev.expected,
          achievement: ev.achievement,
          status: ev.status,
          goalId: k.goal_id,
          department: deptsRaw.find((d) => d.id === k.department_id)?.short_name ?? null,
          measuredOn: k.measured_on ?? null,
        };
      });
    const axes = new Map((raw.exec.axes as Raw[]).map((a) => [a.id, a.title]));
    const goals: DisplayGoal[] = (raw.exec.goals as Raw[]).map((g) => {
      const ks = kpisAll.filter((k) => k.goalId === g.id);
      const vals = ks.map((k) => k.achievement).filter((v): v is number => v !== null);
      return {
        id: g.id,
        title: g.title,
        axis: axes.get(g.axis_id) ?? null,
        progress: vals.length ? Math.round((vals.reduce((s, v) => s + Math.min(100, Math.max(0, v)), 0) / vals.length) * 10) / 10 : null,
        kpiCount: ks.length,
        achieved: ks.filter((k) => k.status === 'achieved').length,
      };
    });
    exec = { title: raw.exec.title, goals, kpis: kpisAll.slice(0, raw.link.kpi_limit ?? 8), totalKpis: kpisAll.length };
  }

  return {
    status: 'ok',
    generatedAt: raw.generated_at,
    link: { name: raw.link.name, refreshSeconds: raw.link.refresh_seconds, sections, allowNav: !!raw.link.allow_period_nav, kpiLimit: raw.link.kpi_limit },
    period: { year, quarter, today },
    years: raw.years ?? [year],
    orgName: raw.org?.name ?? 'جمعية رواسم',
    ops: {
      progress: org.progress,
      computable: org.computable,
      partial: org.partialProgress,
      planned: org.planned,
      missing: org.missingDepartments.map((id) => deptsRaw.find((d) => d.id === id)?.short_name ?? '—'),
      counts,
      curve,
      quarters,
    },
    depts: sections.departments ? depts : [],
    exec,
  };
}
