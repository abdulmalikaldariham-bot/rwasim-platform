// =====================================================================
// عدادات منفصلة: المشاريع والأنشطة (وحدات العمل) مقابل المهام التنفيذية.
// لا تُدمج في رقم واحد إطلاقًا، ولا تؤثر في احتساب الإنجاز الموزون.
// =====================================================================
import type { ActivityEval, DeptEval, OrgEval, PlanFact } from './types';

export interface WorkCounts {
  /** المشاريع والأنشطة */
  works: { total: number; projects: number; activities: number; completed: number; inProgress: number; late: number; notStarted: number };
  /** المهام التنفيذية (خطوات الأنشطة) — كل مهمة تُعد مرة واحدة مهما تعدد المكلفون */
  tasks: { total: number; completed: number; inProgress: number; late: number; notStarted: number };
}

export function emptyCounts(): WorkCounts {
  return {
    works: { total: 0, projects: 0, activities: 0, completed: 0, inProgress: 0, late: 0, notStarted: 0 },
    tasks: { total: 0, completed: 0, inProgress: 0, late: 0, notStarted: 0 },
  };
}

function addActivity(c: WorkCounts, a: ActivityEval, kind: string | undefined, statuses: Map<string, string>) {
  c.works.total++;
  if (kind === 'project') c.works.projects++;
  else c.works.activities++;
  if (a.state === 'completed') c.works.completed++;
  else if (a.state === 'in_progress') c.works.inProgress++;
  else if (a.state === 'late' || a.state === 'stalled') c.works.late++;
  else c.works.notStarted++;
  for (const s of a.steps) {
    c.tasks.total++;
    const st = statuses.get(s.id);
    if (st === 'completed') c.tasks.completed++;
    else if (s.isLate) c.tasks.late++;
    else if (st === 'in_progress' || st === 'on_hold' || s.progress > 0) c.tasks.inProgress++;
    else c.tasks.notStarted++;
  }
}

/** عدادات إدارة واحدة (تتطلب الخطة لمعرفة نوع النشاط وحالة المهام) */
export function deptCounts(d: DeptEval, plan: PlanFact | null | undefined): WorkCounts {
  const c = emptyCounts();
  if (!plan) return c;
  const kinds = new Map(plan.activities.map((a) => [a.id, a.kind]));
  const statuses = new Map(plan.activities.flatMap((a) => a.steps.map((s) => [s.id, s.status] as [string, string])));
  for (const a of d.activities) addActivity(c, a, kinds.get(a.id), statuses);
  return c;
}

/** عدادات الجمعية: مجموع الإدارات ذات الخطط المعتمدة */
export function orgCounts(org: OrgEval, plans: PlanFact[]): WorkCounts {
  const c = emptyCounts();
  for (const d of org.departments) {
    const dc = deptCounts(d, plans.find((p) => p.id === d.planId));
    for (const k of Object.keys(c.works) as (keyof WorkCounts['works'])[]) c.works[k] += dc.works[k];
    for (const k of Object.keys(c.tasks) as (keyof WorkCounts['tasks'])[]) c.tasks[k] += dc.tasks[k];
  }
  return c;
}
