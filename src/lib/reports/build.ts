import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateQuarter, loadYearProgress, type YearProgress } from '../data/progress';
import { loadActivities } from '../data/plans';
import { loadExecPlan } from '../data/kpis';
import { evaluateStep, todayISO } from '../engine/progress';
import { MONTHS, QUARTER_LABEL } from '../labels';
import type { DataState, OrgEval } from '../engine/types';
import type { KpiStatus } from '../engine/kpi';

export type ReportType = 'monthly' | 'quarterly' | 'annual';

export interface ReportSnapshot {
  version: 1;
  meta: {
    type: ReportType;
    year: number;
    quarter: number | null;
    month: number | null;
    departmentId: string | null;
    departmentName: string | null;
    periodLabel: string;
    asOf: string;
    generatedAt: string;
    generatedBy: string;
    weightsVersion: number | null;
  };
  operational: {
    progress: number | null;
    computable: boolean;
    partialProgress: number | null;
    planned: number | null;
    missingDepartments: string[];
    departments: { id: string; name: string; progress: number | null; planned: number | null; dataState: DataState; activities: number; completed: number; late: number; stalled: number }[];
    quarters?: { quarter: number; progress: number | null; partial: number | null; computable: boolean; hasPlans: boolean }[];
    months?: { month: number; scheduled: number; done: number; late: number }[];
  };
  achievements: { department: string; activity: string; step: string; date: string | null }[];
  completedActivities: { department: string; activity: string }[];
  lateItems: { department: string; activity: string; step: string; dueDate: string | null; daysLate: number; responsible: string | null }[];
  kpis: { axis: string; goal: string; name: string; unit: string | null; target: number | null; actual: number | null; achievement: number | null; status: KpiStatus; department: string | null }[];
  deviations: string[];
  challenges: { title: string; department: string | null; kind: string; status: string; resolution: string | null }[];
  directives: { title: string; status: string; due: string | null }[];
  comparison?: { year: number; operational: (number | null)[]; kpiAchieved: number; kpiTotal: number }[];
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function buildReportSnapshot(
  sb: SupabaseClient,
  input: { type: ReportType; year: number; quarter?: number | null; month?: number | null; departmentId?: string | null; generatedBy: string },
): Promise<ReportSnapshot> {
  const today = todayISO();
  const { type, year } = input;
  const quarter = type === 'monthly' ? Math.ceil((input.month ?? 1) / 3) : type === 'quarterly' ? input.quarter ?? 1 : null;
  const month = type === 'monthly' ? input.month ?? 1 : null;
  const periodEnd = type === 'monthly' ? lastDayOfMonth(year, month!) : type === 'quarterly' ? lastDayOfMonth(year, quarter! * 3) : `${year}-12-31`;
  const periodStart = type === 'monthly' ? `${year}-${String(month).padStart(2, '0')}-01` : type === 'quarterly' ? `${year}-${String((quarter! - 1) * 3 + 1).padStart(2, '0')}-01` : `${year}-01-01`;
  const asOf = periodEnd < today ? periodEnd : today;

  const { data: depts } = await sb.from('departments').select('id,name');
  const dn = (id: string | null | undefined) => (depts ?? []).find((d) => d.id === id)?.name ?? '—';
  const yp = await loadYearProgress(sb, year);
  const focusQ = quarter ?? Math.min(4, Math.ceil(Number(asOf.slice(5, 7)) / 3));
  const org: OrgEval = evaluateQuarter(yp, focusQ, { asOf });
  const onlyDept = input.departmentId ?? null;
  const deptsEval = org.departments.filter((d) => !onlyDept || d.departmentId === onlyDept);

  const operational: ReportSnapshot['operational'] = {
    progress: onlyDept ? deptsEval[0]?.progress ?? null : org.progress,
    computable: onlyDept ? deptsEval[0]?.progress !== null : org.computable,
    partialProgress: onlyDept ? null : org.partialProgress,
    planned: onlyDept ? deptsEval[0]?.planned ?? null : org.planned,
    missingDepartments: onlyDept ? [] : org.missingDepartments.map(dn),
    departments: deptsEval.map((d) => ({
      id: d.departmentId,
      name: dn(d.departmentId),
      progress: d.progress,
      planned: d.planned,
      dataState: d.dataState,
      activities: d.activitiesTotal,
      completed: d.activitiesCompleted,
      late: d.activitiesLate,
      stalled: d.activitiesStalled,
    })),
  };

  if (type === 'annual') {
    operational.quarters = [1, 2, 3, 4].map((q) => {
      const e = evaluateQuarter(yp, q, { asOf });
      const ed = onlyDept ? e.departments.find((d) => d.departmentId === onlyDept) : null;
      return {
        quarter: q,
        progress: onlyDept ? ed?.progress ?? null : e.progress,
        partial: onlyDept ? null : e.partialProgress,
        computable: onlyDept ? ed?.progress !== null && ed?.progress !== undefined : e.computable,
        hasPlans: yp.plans.some((p) => p.quarter === q && (!onlyDept || p.departmentId === onlyDept)),
      };
    });
  }

  // تفاصيل الأنشطة والخطوات ضمن الفترة
  const plans = yp.plans.filter((p) => (p.status === 'approved' || p.status === 'archived') && (quarter === null || p.quarter === quarter) && (!onlyDept || p.departmentId === onlyDept));
  const acts = await loadActivities(sb, plans.map((p) => p.id), Object.fromEntries(plans.map((p) => [p.id, yp.boundaries[p.quarter]])), asOf);
  const planOf = Object.fromEntries(plans.map((p) => [p.id, p]));
  const achievements: ReportSnapshot['achievements'] = [];
  const lateItems: ReportSnapshot['lateItems'] = [];
  for (const a of acts) {
    const p = planOf[a.plan_id];
    for (const s of a.steps) {
      if (s.status === 'completed' && (!s.actual_end || (s.actual_end >= periodStart && s.actual_end <= periodEnd))) {
        achievements.push({ department: dn(p.departmentId), activity: a.title, step: s.title, date: s.actual_end });
      }
      const e = evaluateStep({ id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks }, yp.boundaries[p.quarter], asOf);
      if (e.isLate) lateItems.push({ department: dn(p.departmentId), activity: a.title, step: s.title, dueDate: e.dueDate, daysLate: e.daysLate, responsible: s.assigneeName ?? s.responsible_text });
    }
  }
  achievements.sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
  lateItems.sort((x, y) => y.daysLate - x.daysLate);

  if (type !== 'annual' && quarter) {
    const b = yp.boundaries[quarter];
    const months = type === 'monthly' ? [month!] : [...new Set(b.map((w) => w.month))];
    operational.months = months.map((m) => {
      const weeks = b.filter((w) => w.month === m).map((w) => w.weekIndex);
      const steps = acts.flatMap((a) => a.steps).filter((s) => s.weeks.some((w) => weeks.includes(w)));
      const end = lastDayOfMonth(year, m);
      const at = end < asOf ? end : asOf;
      return {
        month: m,
        scheduled: steps.length,
        done: steps.filter((s) => s.status === 'completed').length,
        late: steps.filter((s) => evaluateStep({ id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks }, b, at).isLate).length,
      };
    });
  }

  // المؤشرات (تقديرها حسب الربع المعني)
  const ex = await loadExecPlan(sb, year, focusQ);
  const kpis: ReportSnapshot['kpis'] = ex.axes.flatMap((ax) =>
    ax.goals.flatMap((g) =>
      g.kpis
        .filter((k) => !onlyDept || k.department_id === onlyDept)
        .map((k) => ({
          axis: ax.title,
          goal: g.title,
          name: k.name,
          unit: k.unit,
          target: k.annual_target,
          actual: k.actual,
          achievement: k.evaluation.achievement,
          status: k.evaluation.status,
          department: k.department_id ? dn(k.department_id) : null,
        })),
    ),
  );

  // الانحرافات: حقائق محسوبة فقط، والتوصيات يكتبها المدير التنفيذي في تعليقه
  const deviations: string[] = [];
  for (const d of operational.departments) {
    if (d.progress === null) deviations.push(`${d.name}: لا توجد خطة معتمدة للفترة، ولا يُحتسب إنجازها.`);
    else if (d.planned !== null && d.planned - d.progress >= 10) deviations.push(`${d.name}: الإنجاز ${Math.round(d.progress * 10) / 10}٪ مقابل مخطط ${Math.round(d.planned * 10) / 10}٪ (فجوة ${Math.round((d.planned - d.progress) * 10) / 10} نقطة).`);
    if (d.dataState === 'stale' || d.dataState === 'not_updated') deviations.push(`${d.name}: البيانات غير محدثة.`);
  }
  for (const k of kpis.filter((x) => x.status === 'off_track' || x.status === 'at_risk')) deviations.push(`المؤشر «${k.name}» دون المسار المتوقع (التحقق ${k.achievement ?? '—'}٪).`);

  const escQ = sb.from('escalations').select('title,department_id,kind,status,resolution,created_at').gte('created_at', periodStart).lte('created_at', periodEnd + 'T23:59:59');
  const { data: esc } = onlyDept ? await escQ.eq('department_id', onlyDept) : await escQ;
  const dirQ = sb.from('directives').select('title,status,due_date,department_id,created_at').gte('created_at', periodStart).lte('created_at', periodEnd + 'T23:59:59');
  const { data: dirs } = onlyDept ? await dirQ.eq('department_id', onlyDept) : await dirQ;

  let comparison: ReportSnapshot['comparison'];
  if (type === 'annual') {
    const { data: prevYears } = await sb.from('years').select('year').lt('year', year).order('year', { ascending: false }).limit(2);
    comparison = [];
    for (const py of prevYears ?? []) {
      const pyp: YearProgress = await loadYearProgress(sb, py.year);
      if (!pyp.plans.length) continue;
      const pex = await loadExecPlan(sb, py.year, 4);
      comparison.push({
        year: py.year,
        operational: [1, 2, 3, 4].map((q) => {
          const e = evaluateQuarter(pyp, q, { asOf: `${py.year}-12-31` });
          return onlyDept ? e.departments.find((d) => d.departmentId === onlyDept)?.progress ?? null : e.progress;
        }),
        kpiAchieved: pex.kpis.filter((k) => k.evaluation.status === 'achieved').length,
        kpiTotal: pex.kpis.length,
      });
    }
  }

  const periodLabel = type === 'monthly' ? `شهر ${MONTHS[month!]} ${year}م` : type === 'quarterly' ? `${QUARTER_LABEL[quarter!]} ${year}م` : `عام ${year}م`;
  return {
    version: 1,
    meta: {
      type,
      year,
      quarter,
      month,
      departmentId: onlyDept,
      departmentName: onlyDept ? dn(onlyDept) : null,
      periodLabel,
      asOf,
      generatedAt: new Date().toISOString(),
      generatedBy: input.generatedBy,
      weightsVersion: yp.weightsVersion,
    },
    operational,
    achievements: achievements.slice(0, 40),
    completedActivities: acts.filter((a) => a.eval.state === 'completed').map((a) => ({ department: dn(planOf[a.plan_id].departmentId), activity: a.title })),
    lateItems: lateItems.slice(0, 40),
    kpis,
    deviations,
    challenges: (esc ?? []).map((e) => ({ title: e.title, department: e.department_id ? dn(e.department_id) : null, kind: e.kind, status: e.status, resolution: e.resolution })),
    directives: (dirs ?? []).map((d) => ({ title: d.title, status: d.status, due: d.due_date })),
    comparison,
  };
}
