import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { resolvePeriod } from '@/lib/data/common';
import { getBoundaries, loadStepsOnly } from '@/lib/data/plans';
import { toTask } from '@/lib/data/tasks';
import { currentWeekIndex } from '@/lib/engine/progress';
import { EmptyState, PageHeader } from '@/components/ui';
import { TaskCard } from '@/components/tasks/task-card';
import { MONTHS } from '@/lib/labels';
import type { WeekBoundary } from '@/lib/engine/types';

export const metadata = { title: 'مهامي' };

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const period = await resolvePeriod(sb, {});
  const steps = (await loadStepsOnly(sb, { assignee: profile.id })).filter((s) => s.plan.status === 'approved');
  const view = sp.view === 'month' ? 'month' : sp.view === 'done' ? 'done' : 'week';

  const bCache = new Map<string, WeekBoundary[]>();
  for (const s of steps) {
    const k = `${s.plan.year}-${s.plan.quarter}`;
    if (!bCache.has(k)) bCache.set(k, await getBoundaries(sb, s.plan.year, s.plan.quarter));
  }
  const tasks = steps.map((s) => {
    const b = bCache.get(`${s.plan.year}-${s.plan.quarter}`)!;
    return { s, b, t: toTask(s, { activityTitle: s.activityTitle, boundaries: b, asOf: period.today, canUpdate: true, departmentId: s.plan.department_id }) };
  });
  const open = tasks.filter((x) => x.s.status !== 'completed');
  const late = open.filter((x) => x.t.isLate).sort((a, b) => b.t.daysLate - a.t.daysLate);
  const week = open.filter((x) => {
    const cw = currentWeekIndex(x.b, period.today);
    return !x.t.isLate && cw !== null && x.s.weeks.includes(cw);
  });
  const curMonth = Number(period.today.slice(5, 7));
  const month = open.filter((x) => !x.t.isLate && x.b.some((w) => w.month === curMonth && x.s.weeks.includes(w.weekIndex)));
  const done = tasks.filter((x) => x.s.status === 'completed');

  const tabs: [string, string, number][] = [
    ['week', 'هذا الأسبوع', week.length + late.length],
    ['month', `شهر ${MONTHS[curMonth]}`, month.length],
    ['done', 'المنجزة', done.length],
  ];

  return (
    <>
      <PageHeader title="مهامي" sub={`مرحبًا ${profile.full_name}. هذه المهام المسندة إليك فقط.`} />
      {tasks.length === 0 ? (
        <EmptyState title="لا توجد مهام مسندة إليك" body="تظهر هنا الخطوات التي يفوضك بها مدير إدارتك بعد اعتماد الخطة." />
      ) : (
        <>
          <nav className="mb-5 flex gap-1 rounded-lg border border-line bg-surface p-1 sm:w-fit" aria-label="العرض">
            {tabs.map(([k, l, n]) => (
              <Link key={k} href={`/my-tasks?view=${k}`} aria-current={view === k ? 'page' : undefined} className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm sm:flex-none ${view === k ? 'bg-teal font-semibold text-white dark:text-[#04141b]' : 'text-muted'}`}>
                {l} <span className="num">({n})</span>
              </Link>
            ))}
          </nav>
          {view === 'week' && (
            <div className="space-y-5">
              {late.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-late">متأخرة — أنجزها أولًا</h2>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{late.map((x) => <TaskCard key={x.t.id} t={x.t} />)}</div>
                </section>
              )}
              <section>
                <h2 className="mb-2 text-sm font-semibold text-ink">مجدولة هذا الأسبوع</h2>
                {week.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{week.map((x) => <TaskCard key={x.t.id} t={x.t} />)}</div>
                ) : (
                  <p className="text-sm text-muted">لا مهام أخرى هذا الأسبوع.</p>
                )}
              </section>
            </div>
          )}
          {view === 'month' &&
            (month.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{month.map((x) => <TaskCard key={x.t.id} t={x.t} />)}</div>
            ) : (
              <EmptyState title="لا مهام مفتوحة هذا الشهر" />
            ))}
          {view === 'done' &&
            (done.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{done.map((x) => <TaskCard key={x.t.id} t={x.t} />)}</div>
            ) : (
              <EmptyState title="لم تكمل مهام بعد" />
            ))}
        </>
      )}
    </>
  );
}
