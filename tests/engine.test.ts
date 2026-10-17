import { describe, expect, it } from 'vitest';
import {
  computeStepProgress,
  evaluateActivity,
  evaluateDepartment,
  evaluateOrg,
  plannedStepFraction,
  quarterCurve,
  weightsValid,
} from '../src/lib/engine/progress';
import type { PlanFact, StepFact, WeekBoundary } from '../src/lib/engine/types';

// حدود أسابيع الربع الرابع 2026 (الافتراضية)
const Q4: WeekBoundary[] = [];
for (let wi = 1; wi <= 12; wi++) {
  const m = 10 + Math.floor((wi - 1) / 4);
  const wom = ((wi - 1) % 4) + 1;
  const start = `2026-${m}-${String(1 + (wom - 1) * 7).padStart(2, '0')}`;
  const lastDay = m === 11 ? 30 : 31;
  const end = `2026-${m}-${String(wom < 4 ? 7 * wom : lastDay).padStart(2, '0')}`;
  Q4.push({ weekIndex: wi, month: m, weekOfMonth: wom, start, end });
}

const step = (id: string, weight: number, status: StepFact['status'] = 'not_started', weeks: number[] = [1], progress?: number): StepFact => ({
  id,
  weight,
  status,
  progress: progress ?? (status === 'completed' ? 100 : 0),
  weeks,
});

describe('المستوى 1: إنجاز الخطوة', () => {
  it('المكتملة 100 وغير المكتملة صفر', () => {
    expect(computeStepProgress('completed')).toBe(100);
    expect(computeStepProgress('in_progress')).toBe(0);
    expect(computeStepProgress('not_started')).toBe(0);
    expect(computeStepProgress('on_hold')).toBe(0);
  });
  it('بدء العمل لا يحتسب الخطوة كاملة', () => {
    expect(computeStepProgress('in_progress', [])).toBe(0);
  });
  it('المراحل الفرعية تحتسب بأوزانها', () => {
    const subs = [
      { weight: 50, isDone: true },
      { weight: 30, isDone: false },
      { weight: 20, isDone: true },
    ];
    expect(computeStepProgress('in_progress', subs)).toBe(70);
    expect(computeStepProgress('in_progress', subs.map((s) => ({ ...s, isDone: true })))).toBe(100);
  });
  it('دورات بأوزان كسرية تكتمل إلى 100 تمامًا', () => {
    const subs = [33.33, 33.33, 33.34].map((w) => ({ weight: w, isDone: true }));
    expect(computeStepProgress('in_progress', subs)).toBe(100);
  });
});

describe('المستوى 2: إنجاز النشاط (مثال المشروع)', () => {
  // إنضاج 10، وثيقة 10، اعتماد 10، تجهيز 20، تنفيذ 40، إغلاق 10
  const project = {
    id: 'a1',
    weight: 40,
    steps: [step('s1', 10), step('s2', 10), step('s3', 10), step('s4', 20), step('s5', 40), step('s6', 10)],
  };
  it('مجموع الأوزان 100', () => expect(weightsValid(project.steps)).toBe(true));
  it('لا شيء مكتمل = 0', () => expect(evaluateActivity(project, Q4, '2026-10-02').progress).toBe(0));
  it('اكتمال الإنضاج والوثيقة والاعتماد = 30', () => {
    const a = { ...project, steps: project.steps.map((s, i) => (i < 3 ? { ...s, status: 'completed' as const, progress: 100 } : s)) };
    expect(evaluateActivity(a, Q4, '2026-10-02').progress).toBe(30);
  });
  it('+ التنفيذ (الجوهرية) = 70', () => {
    const a = { ...project, steps: project.steps.map((s, i) => (i < 3 || i === 4 ? { ...s, status: 'completed' as const, progress: 100 } : s)) };
    expect(evaluateActivity(a, Q4, '2026-10-02').progress).toBe(70);
  });
  it('كل الخطوات = 100 والحالة مكتملة', () => {
    const a = { ...project, steps: project.steps.map((s) => ({ ...s, status: 'completed' as const, progress: 100 })) };
    const e = evaluateActivity(a, Q4, '2026-10-02');
    expect(e.progress).toBe(100);
    expect(e.state).toBe('completed');
  });
  it('الخطوة الجارية دون مراحل لا تضيف إنجازًا', () => {
    const a = { ...project, steps: project.steps.map((s, i) => (i === 4 ? { ...s, status: 'in_progress' as const } : s)) };
    expect(evaluateActivity(a, Q4, '2026-10-02').progress).toBe(0);
  });
  it('المرحلة الفرعية داخل الجوهرية: نصفها = 20', () => {
    const a = { ...project, steps: project.steps.map((s, i) => (i === 4 ? { ...s, status: 'in_progress' as const, progress: 50 } : s)) };
    expect(evaluateActivity(a, Q4, '2026-10-02').progress).toBe(20);
  });
});

describe('المستوى 3: إنجاز الإدارة (أوزان غير متساوية)', () => {
  const full = (id: string, w: number) => ({ id, weight: w, steps: [step(id + 's', 100, 'completed', [1])] });
  const none = (id: string, w: number) => ({ id, weight: w, steps: [step(id + 's', 100, 'not_started', [1])] });
  it('40/30/20/10 — اكتمال الأول والثالث = 60', () => {
    const plan: PlanFact = { id: 'p', departmentId: 'd', quarter: 4, status: 'approved', activities: [full('a', 40), none('b', 30), full('c', 20), none('d', 10)] };
    expect(evaluateDepartment('d', plan, Q4, { asOf: '2026-10-05' }).progress).toBe(60);
  });
  it('لا تعرض إدارة بلا خطة معتمدة كصفر', () => {
    const plan: PlanFact = { id: 'p', departmentId: 'd', quarter: 4, status: 'draft', activities: [full('a', 100)] };
    const e = evaluateDepartment('d', plan, Q4, { asOf: '2026-10-05' });
    expect(e.progress).toBeNull();
    expect(e.dataState).toBe('not_approved');
    expect(evaluateDepartment('d', null, Q4, { asOf: '2026-10-05' }).dataState).toBe('no_plan');
  });
  it('يميز «غير محدث» عن الصفر المؤكد', () => {
    const plan: PlanFact = { id: 'p', departmentId: 'd', quarter: 4, status: 'approved', activities: [none('a', 100)] };
    expect(evaluateDepartment('d', plan, Q4, { asOf: '2026-10-20' }).dataState).toBe('not_updated');
    const updated: PlanFact = {
      ...plan,
      activities: [{ id: 'a', weight: 100, steps: [{ ...step('x', 100, 'in_progress', [1]), lastUpdateAt: '2026-10-19T08:00:00Z' }] }],
    };
    const e = evaluateDepartment('d', updated, Q4, { asOf: '2026-10-20' });
    expect(e.dataState).toBe('ok');
    expect(e.progress).toBe(0);
  });
  it('الإنجاز لا يتجاوز 100', () => {
    const plan: PlanFact = { id: 'p', departmentId: 'd', quarter: 4, status: 'approved', activities: [{ id: 'a', weight: 100, steps: [{ ...step('x', 100, 'completed'), progress: 140 }] }] };
    expect(evaluateDepartment('d', plan, Q4, { asOf: '2026-10-05' }).progress).toBe(100);
  });
});

describe('المستوى 4: إنجاز الجمعية', () => {
  const weights = ['d1', 'd2', 'd3', 'd4', 'd5'].map((d) => ({ departmentId: d, weight: 20 }));
  const planWith = (dept: string, pct: number): PlanFact => ({
    id: 'p' + dept,
    departmentId: dept,
    quarter: 4,
    status: 'approved',
    activities: [
      { id: dept + 'a', weight: pct, steps: [step(dept + 's1', 100, 'completed')] },
      { id: dept + 'b', weight: 100 - pct, steps: [step(dept + 's2', 100, 'not_started')] },
    ],
  });
  it('= مجموع إنجاز الإدارات ÷ 5', () => {
    const plans = [planWith('d1', 50), planWith('d2', 100), planWith('d3', 0), planWith('d4', 30), planWith('d5', 70)];
    const org = evaluateOrg(weights, plans, Q4, { asOf: '2026-10-05' });
    expect(org.computable).toBe(true);
    expect(org.progress).toBe(50); // (50+100+0+30+70)/5
  });
  it('عدد الأنشطة لا يمنح الإدارة وزنًا أكبر', () => {
    const many: PlanFact = {
      id: 'pm',
      departmentId: 'd1',
      quarter: 4,
      status: 'approved',
      activities: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, weight: 5, steps: [step('ms' + i, 100, 'completed')] })),
    };
    const plans = [many, planWith('d2', 0), planWith('d3', 0), planWith('d4', 0), planWith('d5', 0)];
    expect(evaluateOrg(weights, plans, Q4, { asOf: '2026-10-05' }).progress).toBe(20);
  });
  it('غير قابلة للاحتساب عند غياب خطة معتمدة لإدارة، مع مؤشر جزئي واضح', () => {
    const plans = [planWith('d1', 50), planWith('d2', 100), planWith('d3', 0), planWith('d4', 30)];
    const org = evaluateOrg(weights, plans, Q4, { asOf: '2026-10-05' });
    expect(org.computable).toBe(false);
    expect(org.progress).toBeNull();
    expect(org.missingDepartments).toEqual(['d5']);
    expect(org.coveredWeight).toBe(80);
    expect(org.partialProgress).toBe(45); // (50+100+0+30)/4
  });
  it('أوزان مخصصة للإدارات', () => {
    const w = [
      { departmentId: 'd1', weight: 50 },
      { departmentId: 'd2', weight: 30 },
      { departmentId: 'd3', weight: 20 },
    ];
    const org = evaluateOrg(w, [planWith('d1', 100), planWith('d2', 0), planWith('d3', 50)], Q4, { asOf: '2026-10-05' });
    expect(org.progress).toBe(60);
  });
});

describe('الجدولة والتأخر', () => {
  it('الإنجاز المخطط للخطوة الممتدة عدة أسابيع', () => {
    expect(plannedStepFraction([1, 2], Q4, '2026-09-30')).toBe(0);
    expect(plannedStepFraction([1, 2], Q4, '2026-10-07')).toBe(0.5);
    expect(plannedStepFraction([1, 2], Q4, '2026-10-14')).toBe(1);
  });
  it('الخطوة المتأخرة لا تختفي بانتهاء أسبوعها', () => {
    const a = { id: 'a', weight: 100, steps: [step('s', 100, 'not_started', [1])] };
    const e = evaluateActivity(a, Q4, '2026-10-20');
    expect(e.steps[0].isLate).toBe(true);
    expect(e.steps[0].daysLate).toBe(13);
    expect(e.state).toBe('late');
  });
  it('التعثر بعد تجاوز 14 يومًا أو عند التعليق', () => {
    const a = { id: 'a', weight: 100, steps: [step('s', 100, 'not_started', [1])] };
    expect(evaluateActivity(a, Q4, '2026-10-25').state).toBe('stalled');
    const held = { id: 'a', weight: 100, steps: [step('s', 100, 'on_hold', [5])] };
    expect(evaluateActivity(held, Q4, '2026-10-02').state).toBe('stalled');
  });
  it('منحنى المخطط مقابل المتحقق', () => {
    const plan: PlanFact = {
      id: 'p',
      departmentId: 'd',
      quarter: 4,
      status: 'approved',
      activities: [{ id: 'a', weight: 100, steps: [{ ...step('s1', 50, 'completed', [1]), actualEnd: '2026-10-06' }, step('s2', 50, 'not_started', [2])] }],
    };
    const c = quarterCurve(plan, Q4, '2026-10-10');
    expect(c[0].planned).toBe(50);
    expect(c[0].actual).toBe(50);
    expect(c[1].planned).toBe(100);
    expect(c[2].actual).toBeNull(); // أسبوع لم يبدأ
  });
});

// ---------------------------------------------------------------------
// الإصدار الثاني: الإنجاز الفردي، الحالة الزمنية، التواريخ اليدوية، العدادات المنفصلة
// ---------------------------------------------------------------------
import { computeIndividualProgress, timeStateOf, evaluateStep as evalStep2, evaluateDepartment as evalDept2 } from '../src/lib/engine/progress';
import { deptCounts } from '../src/lib/engine/counts';

describe('الإصدار الثاني', () => {
  it('الإنجاز الفردي: يكتمل بالعتبة الجماعية ولا يغلقه شخص واحد', () => {
    expect(computeIndividualProgress(1, 3, 100)).toEqual({ progress: 33.33, completed: false });
    expect(computeIndividualProgress(3, 3, 100)).toEqual({ progress: 100, completed: true });
    expect(computeIndividualProgress(2, 4, 50)).toEqual({ progress: 100, completed: true });
    expect(computeIndividualProgress(0, 0, 100)).toEqual({ progress: 0, completed: false });
  });

  it('الحالة الزمنية منفصلة عن حالة التنفيذ', () => {
    expect(timeStateOf('not_started', '2026-10-10', '2026-10-20', '2026-10-05')).toBe('upcoming');
    expect(timeStateOf('in_progress', '2026-10-10', '2026-10-20', '2026-10-15')).toBe('in_window');
    expect(timeStateOf('in_progress', '2026-10-10', '2026-10-20', '2026-10-25')).toBe('overdue');
    expect(timeStateOf('completed', '2026-10-10', '2026-10-20', '2026-10-25')).toBe('done');
    expect(timeStateOf('not_started', null, null, '2026-10-25')).toBe('unscheduled');
  });

  const B: WeekBoundary[] = Array.from({ length: 12 }, (_, i) => {
    const s = new Date(Date.UTC(2026, 9, 1 + i * 7));
    const e = new Date(Date.UTC(2026, 9, 7 + i * 7));
    return { weekIndex: i + 1, month: 10 + Math.floor(i / 4), weekOfMonth: (i % 4) + 1, start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  });

  it('التاريخ اليدوي يتقدم على الأسابيع في الموعد والتأخر', () => {
    const s: StepFact = { id: 's', weight: 100, progress: 0, status: 'not_started', weeks: [1], startDate: '2026-11-01', endDate: '2026-11-10', datesSource: 'manual' };
    const e = evalStep2(s, B, '2026-10-20');
    expect(e.dueDate).toBe('2026-11-10');
    expect(e.isLate).toBe(false);
    expect(e.timeState).toBe('upcoming');
  });

  it('العدادات: المشاريع والأنشطة منفصلة عن المهام ولا تؤثر في الإنجاز', () => {
    const plan: PlanFact = {
      id: 'p',
      departmentId: 'd',
      quarter: 4,
      status: 'approved',
      activities: [
        { id: 'a1', weight: 60, kind: 'project', steps: [
          { id: 'x1', weight: 40, progress: 100, status: 'completed', weeks: [1] },
          { id: 'x2', weight: 60, progress: 0, status: 'not_started', weeks: [10] },
        ] },
        { id: 'a2', weight: 40, kind: 'recurring', steps: [{ id: 'y1', weight: 100, progress: 100, status: 'completed', weeks: [1] }] },
      ],
    };
    const d = evalDept2('d', plan, B, { asOf: '2026-10-20' });
    expect(d.progress).toBe(0.4 * 60 + 40);
    const c = deptCounts(d, plan);
    expect(c.works).toMatchObject({ total: 2, projects: 1, activities: 1, completed: 1 });
    expect(c.tasks).toMatchObject({ total: 3, completed: 2 });
  });
});
