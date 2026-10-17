// =====================================================================
// محرك احتساب الإنجاز — رواسم
// ---------------------------------------------------------------------
// المستوى 1: الخطوة   → إنجازها 100 عند الاكتمال، 0 لغير المكتملة،
//                       أو نسبة المراحل الفرعية المنجزة إن وجدت.
// المستوى 2: النشاط   → Σ (وزن الخطوة × إنجازها) / 100
// المستوى 3: الإدارة  → Σ (وزن النشاط × إنجازه) / 100
// المستوى 4: الجمعية  → Σ (وزن الإدارة × إنجازها) / 100
// لا يتأثر وزن الإدارة بعدد أنشطتها أو خطواتها.
// =====================================================================

import type {
  ActivityEval,
  ActivityFact,
  ActivityState,
  DataState,
  DeptEval,
  DeptWeight,
  OrgEval,
  PlanFact,
  StepEval,
  StepFact,
  StepStatus,
  StepTiming,
  WeekBoundary,
} from './types';

export const WEIGHT_TOLERANCE = 0.01;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function sumWeights(items: { weight: number }[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.weight) || 0), 0));
}

export function weightsValid(items: { weight: number }[]): boolean {
  if (items.length === 0) return false;
  if (items.some((i) => !(Number(i.weight) >= 0))) return false;
  return Math.abs(sumWeights(items) - 100) <= WEIGHT_TOLERANCE;
}

// ---------------------------------------------------------------------
// المستوى 1: الخطوة
// ---------------------------------------------------------------------

export interface SubstepInput {
  weight: number;
  isDone: boolean;
}

/** نفس منطق الدالة update_step_progress في قاعدة البيانات (للمعاينة والاختبار) */
export function computeStepProgress(status: StepStatus, substeps: SubstepInput[] = []): number {
  if (substeps.length > 0) {
    const done = substeps.filter((s) => s.isDone).reduce((s, x) => s + x.weight, 0);
    const p = clamp(round2(done));
    return p >= 99.995 ? 100 : p;
  }
  return status === 'completed' ? 100 : 0;
}

// ---------------------------------------------------------------------
// الزمن والجدولة
// ---------------------------------------------------------------------

function toDate(d: string): number {
  return Date.parse(d + 'T00:00:00Z');
}
const DAY = 86_400_000;

export function todayISO(now: Date = new Date()): string {
  // التاريخ في الرياض
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

export function stepWindow(
  weeks: number[],
  boundaries: WeekBoundary[],
  dates?: { start?: string | null; end?: string | null },
): { start: string | null; end: string | null } {
  // التاريخان المعتمدان للمهمة لهما الأولوية، ثم نافذة الجدولة الأسبوعية
  if (dates?.start && dates?.end) return { start: dates.start, end: dates.end };
  if (!weeks.length) return { start: null, end: null };
  const byIdx = new Map(boundaries.map((b) => [b.weekIndex, b]));
  const sorted = [...weeks].sort((a, b) => a - b);
  const first = byIdx.get(sorted[0]);
  const last = byIdx.get(sorted[sorted.length - 1]);
  return { start: first?.start ?? null, end: last?.end ?? null };
}

/**
 * الإنجاز المخطط للخطوة حتى تاريخ معين: نسبة الأسابيع المجدولة المنقضية (مع جزء الأسبوع الجاري بالأيام).
 * المهمة دون أسابيع ولها تاريخان: توزيع خطي بين التاريخين. دونهما: توزيع خطي على الربع.
 */
export function plannedStepFraction(weeks: number[], boundaries: WeekBoundary[], asOf: string, dates?: { start?: string | null; end?: string | null }): number {
  const t = toDate(asOf);
  const byIdx = new Map(boundaries.map((b) => [b.weekIndex, b]));
  if (!weeks.length) {
    if (dates?.start && dates?.end) {
      const s = toDate(dates.start);
      const e = toDate(dates.end) + DAY;
      return clamp((t + DAY - s) / Math.max(DAY, e - s), 0, 1);
    }
    // بلا جدولة: يفترض توزيعًا خطيًا على الربع كاملًا
    if (!boundaries.length) return 0;
    const qs = toDate(boundaries[0].start);
    const qe = toDate(boundaries[boundaries.length - 1].end) + DAY;
    return clamp((t + DAY - qs) / (qe - qs), 0, 1);
  }
  let total = 0;
  for (const w of weeks) {
    const b = byIdx.get(w);
    if (!b) continue;
    const s = toDate(b.start);
    const e = toDate(b.end) + DAY; // نهاية اليوم الأخير
    if (t + DAY >= e) total += 1;
    else if (t + DAY > s) total += (t + DAY - s) / (e - s);
  }
  return clamp(total / weeks.length, 0, 1);
}

/** الحالة الزمنية: لم يحن موعدها، ضمن فترة التنفيذ، متأخرة، مكتملة — دون خلطها بحالة التنفيذ */
export function stepTiming(status: StepStatus, window: { start: string | null; end: string | null }, asOf: string): StepTiming {
  if (status === 'completed') return 'done';
  if (!window.end) return 'unscheduled';
  const t = toDate(asOf);
  if (t > toDate(window.end)) return 'overdue';
  if (window.start && t < toDate(window.start)) return 'not_due';
  return 'in_window';
}

export function isWeekCurrent(weeks: number[], boundaries: WeekBoundary[], asOf: string): boolean {
  const t = toDate(asOf);
  return boundaries.some((b) => weeks.includes(b.weekIndex) && toDate(b.start) <= t && t <= toDate(b.end));
}

export function currentWeekIndex(boundaries: WeekBoundary[], asOf: string): number | null {
  const t = toDate(asOf);
  const b = boundaries.find((x) => toDate(x.start) <= t && t <= toDate(x.end));
  return b ? b.weekIndex : null;
}

// ---------------------------------------------------------------------
// تقييم الخطوة والنشاط
// ---------------------------------------------------------------------

export function evaluateStep(step: StepFact, boundaries: WeekBoundary[], asOf: string): StepEval {
  const dates = { start: step.plannedStart ?? null, end: step.plannedEnd ?? null };
  const { start, end } = stepWindow(step.weeks, boundaries, dates);
  const progress = clamp(Number(step.progress) || 0);
  const isLate = !!end && progress < 100 && toDate(asOf) > toDate(end);
  const daysLate = isLate && end ? Math.floor((toDate(asOf) - toDate(end)) / DAY) : 0;
  const isCurrent = start && end ? toDate(start) <= toDate(asOf) && toDate(asOf) <= toDate(end) : isWeekCurrent(step.weeks, boundaries, asOf);
  return {
    id: step.id,
    timing: stepTiming(step.status, { start, end }, asOf),
    progress,
    planned: round2(plannedStepFraction(step.weeks, boundaries, asOf, dates) * 100),
    dueDate: end,
    startDate: start,
    isLate,
    daysLate,
    isCurrentWeek: step.weeks.length ? isWeekCurrent(step.weeks, boundaries, asOf) : !!isCurrent,
  };
}

export const STALLED_AFTER_DAYS = 14;

export function evaluateActivity(a: ActivityFact, boundaries: WeekBoundary[], asOf: string): ActivityEval {
  const steps = a.steps.map((s) => evaluateStep(s, boundaries, asOf));
  const weightIssue = !weightsValid(a.steps);
  // Σ (وزن × إنجاز) / 100
  let progress = 0;
  let planned = 0;
  a.steps.forEach((s, i) => {
    progress += (Number(s.weight) || 0) * steps[i].progress;
    planned += (Number(s.weight) || 0) * steps[i].planned;
  });
  progress = clamp(round2(progress / 100));
  planned = clamp(round2(planned / 100));

  const lateSteps = steps.filter((s) => s.isLate).length;
  const stepsCompleted = a.steps.filter((s) => s.status === 'completed').length;
  const onHold = a.steps.some((s) => s.status === 'on_hold');
  const maxLate = Math.max(0, ...steps.map((s) => s.daysLate));
  const started = a.steps.some((s) => s.status !== 'not_started') || progress > 0;
  const starts = steps.map((s) => s.startDate).filter(Boolean) as string[];
  const firstStart = starts.sort()[0];
  const dues = steps.map((s) => s.dueDate).filter(Boolean) as string[];
  const dueDate = dues.sort().at(-1) ?? null;

  let state: ActivityState;
  if (a.steps.length > 0 && progress >= 100) state = 'completed';
  else if (onHold || maxLate > STALLED_AFTER_DAYS) state = 'stalled';
  else if (lateSteps > 0) state = 'late';
  else if (started) state = 'in_progress';
  else if (firstStart && toDate(asOf) < toDate(firstStart)) state = 'upcoming';
  else state = 'not_started';

  return {
    id: a.id,
    kind: a.kind,
    progress,
    planned,
    state,
    stepsTotal: a.steps.length,
    stepsCompleted,
    lateSteps,
    dueDate,
    weightIssue,
    steps,
  };
}

// ---------------------------------------------------------------------
// المستوى 3: الإدارة
// ---------------------------------------------------------------------

export interface EvalOptions {
  asOf: string;
  staleAfterDays?: number;
}

export function evaluateDepartment(
  departmentId: string,
  plan: PlanFact | null,
  boundaries: WeekBoundary[],
  opts: EvalOptions,
): DeptEval {
  const empty: DeptEval = {
    departmentId,
    planId: plan?.id ?? null,
    planStatus: plan?.status ?? null,
    dataState: plan ? 'not_approved' : 'no_plan',
    progress: null,
    planned: null,
    activitiesTotal: plan?.activities.length ?? 0,
    activitiesCompleted: 0,
    activitiesLate: 0,
    activitiesInProgress: 0,
    activitiesStalled: 0,
    activitiesNotStarted: 0,
    projectsTotal: plan?.activities.filter((a) => a.kind === 'project').length ?? 0,
    projectsCompleted: 0,
    stepsTotal: plan?.activities.reduce((s, a) => s + a.steps.length, 0) ?? 0,
    stepsCompleted: 0,
    stepsInProgress: 0,
    stepsLate: 0,
    lastUpdateAt: null,
    weightIssue: false,
    activities: [],
  };
  if (!plan || (plan.status !== 'approved' && plan.status !== 'archived')) return empty;

  const activities = plan.activities.map((a) => evaluateActivity(a, boundaries, opts.asOf));
  let progress = 0;
  let planned = 0;
  plan.activities.forEach((a, i) => {
    progress += (Number(a.weight) || 0) * activities[i].progress;
    planned += (Number(a.weight) || 0) * activities[i].planned;
  });
  progress = clamp(round2(progress / 100));
  planned = clamp(round2(planned / 100));

  const allSteps = plan.activities.flatMap((a) => a.steps);
  const updates = allSteps.map((s) => s.lastUpdateAt).filter(Boolean) as string[];
  const lastUpdateAt = updates.sort().at(-1) ?? null;
  const hasDueWork = activities.some((a) => a.planned > 0);

  let dataState: DataState = 'ok';
  const staleDays = opts.staleAfterDays ?? 14;
  if (!lastUpdateAt) {
    if (hasDueWork) dataState = 'not_updated';
  } else {
    const ageDays = (toDate(opts.asOf) - Date.parse(lastUpdateAt)) / DAY;
    if (ageDays > staleDays && progress < 100 && hasDueWork) dataState = 'stale';
  }

  return {
    departmentId,
    planId: plan.id,
    planStatus: plan.status,
    dataState,
    progress,
    planned,
    activitiesTotal: activities.length,
    activitiesCompleted: activities.filter((a) => a.state === 'completed').length,
    activitiesLate: activities.filter((a) => a.state === 'late').length,
    activitiesStalled: activities.filter((a) => a.state === 'stalled').length,
    activitiesInProgress: activities.filter((a) => a.state === 'in_progress').length,
    activitiesNotStarted: activities.filter((a) => a.state === 'not_started' || a.state === 'upcoming').length,
    projectsTotal: activities.filter((a) => a.kind === 'project').length,
    projectsCompleted: activities.filter((a) => a.kind === 'project' && a.state === 'completed').length,
    stepsTotal: allSteps.length,
    stepsCompleted: allSteps.filter((s) => s.status === 'completed').length,
    stepsInProgress: allSteps.filter((s) => s.status === 'in_progress' || s.status === 'on_hold').length,
    stepsLate: activities.reduce((n, a) => n + a.lateSteps, 0),
    lastUpdateAt,
    weightIssue: !weightsValid(plan.activities) || activities.some((a) => a.weightIssue),
    activities,
  };
}

// ---------------------------------------------------------------------
// المستوى 4: الجمعية
// ---------------------------------------------------------------------

export function evaluateOrg(
  deptWeights: DeptWeight[],
  plans: PlanFact[],
  boundaries: WeekBoundary[],
  opts: EvalOptions,
): OrgEval {
  const departments = deptWeights.map((dw) => {
    const plan = plans.find((p) => p.departmentId === dw.departmentId) ?? null;
    return evaluateDepartment(dw.departmentId, plan, boundaries, opts);
  });

  const weighted = deptWeights.filter((d) => d.weight > 0);
  const missing = weighted.filter((dw) => {
    const e = departments.find((d) => d.departmentId === dw.departmentId);
    return !e || e.progress === null;
  });
  const available = weighted.filter((dw) => !missing.includes(dw));
  const coveredWeight = round2(available.reduce((s, d) => s + d.weight, 0));
  const totalWeight = sumWeights(weighted);
  const weightsOk = Math.abs(totalWeight - 100) <= WEIGHT_TOLERANCE;

  const weightedSum = (key: 'progress' | 'planned') =>
    available.reduce((s, dw) => {
      const e = departments.find((d) => d.departmentId === dw.departmentId)!;
      return s + dw.weight * (e[key] ?? 0);
    }, 0);

  const computable = missing.length === 0 && weighted.length > 0 && weightsOk;
  const progress = computable ? clamp(round2(weightedSum('progress') / 100)) : null;
  const planned = computable ? clamp(round2(weightedSum('planned') / 100)) : null;
  const partialProgress = coveredWeight > 0 ? clamp(round2(weightedSum('progress') / coveredWeight)) : null;

  return {
    progress,
    computable,
    partialProgress,
    planned: planned ?? (coveredWeight > 0 ? clamp(round2(weightedSum('planned') / coveredWeight)) : null),
    coveredWeight,
    missingDepartments: missing.map((m) => m.departmentId),
    departments,
  };
}

// ---------------------------------------------------------------------
// منحنى المخطط مقابل المتحقق خلال الربع
// ---------------------------------------------------------------------

const MONTH_SHORT = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export interface CurvePoint {
  weekIndex: number;
  label: string;
  planned: number;
  actual: number | null;
}

/**
 * يحسب الإنجاز المخطط تراكميًا لكل أسبوع، والمتحقق لكل أسبوع منقضٍ
 * بناءً على تاريخ اكتمال الخطوات (actualEnd). الخطوات ذات المراحل الفرعية
 * غير المكتملة تُحتسب بقيمتها الحالية عند الأسبوع الجاري فقط.
 */
export function quarterCurve(plan: PlanFact, boundaries: WeekBoundary[], asOf: string): CurvePoint[] {
  const t = toDate(asOf);
  return boundaries.map((b) => {
    const end = b.end;
    let planned = 0;
    let actual = 0;
    for (const a of plan.activities) {
      let ap = 0;
      let aa = 0;
      for (const s of a.steps) {
        ap += s.weight * plannedStepFraction(s.weeks, boundaries, end, { start: s.plannedStart, end: s.plannedEnd }) * 100;
        const doneBy = s.status === 'completed' && s.actualEnd && toDate(s.actualEnd) <= toDate(end);
        if (doneBy) aa += s.weight * 100;
        else if (s.status !== 'completed' && s.progress > 0 && toDate(b.start) <= t && t <= toDate(end)) aa += s.weight * s.progress;
        else if (s.status === 'completed' && !s.actualEnd && toDate(end) >= t) aa += s.weight * 100;
      }
      planned += a.weight * (ap / 100);
      actual += a.weight * (aa / 100);
    }
    return {
      weekIndex: b.weekIndex,
      label: b.weekOfMonth === 1 ? MONTH_SHORT[b.month] : `س${b.weekOfMonth}`,
      planned: clamp(round2(planned / 100)),
      actual: toDate(b.start) <= t ? clamp(round2(actual / 100)) : null,
    };
  });
}
