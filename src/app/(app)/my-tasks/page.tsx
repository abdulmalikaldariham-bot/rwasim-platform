import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getDepartments, resolvePeriod } from '@/lib/data/common';
import { getBoundaries, loadStepsOnly } from '@/lib/data/plans';
import { toTask } from '@/lib/data/tasks';
import { EmptyState, PageHeader } from '@/components/ui';
import { TaskCard, type TaskCardData } from '@/components/tasks/task-card';
import { MONTHS } from '@/lib/labels';
import type { WeekBoundary } from '@/lib/engine/types';
import { cn } from '@/lib/format';

export const metadata = { title: 'مهامي' };

type View = 'week' | 'month' | 'late' | 'upcoming' | 'done';

function overlaps(t: TaskCardData, from: string, to: string) {
  return !!t.startDate && !!t.dueDate && t.startDate <= to && t.dueDate >= from;
}

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const period = await resolvePeriod(sb, {});
  const depts = await getDepartments(sb, true);
  const steps = (await loadStepsOnly(sb, { assignee: profile.id })).filter((s) => s.plan.status === 'approved' || s.plan.status === 'archived');
  const views: View[] = ['week', 'month', 'late', 'upcoming', 'done'];
  const view: View = views.includes(sp.view as View) ? (sp.view as View) : 'week';

  const bCache = new Map<string, WeekBoundary[]>();
  for (const s of steps) {
    const k = `${s.plan.year}-${s.plan.quarter}`;
    if (!bCache.has(k)) bCache.set(k, await getBoundaries(sb, s.plan.year, s.plan.quarter));
  }
  const today = period.today;
  const tasks = steps.map((s) =>
    toTask(s, {
      activityTitle: s.activityTitle,
      boundaries: bCache.get(`${s.plan.year}-${s.plan.quarter}`)!,
      asOf: today,
      canUpdate: s.plan.status === 'approved',
      departmentId: s.plan.department_id,
      departmentName: depts.find((d) => d.id === s.plan.department_id)?.short_name ?? undefined,
      me: profile.id,
    }),
  );
  const isDone = (t: TaskCardData) => (t.individual && t.myDone !== undefined ? t.myDone : t.status === 'completed');
  const open = tasks.filter((t) => !isDone(t));

  // حدود الأسبوع (الأحد–السبت) والشهر الحاليين
  const d = new Date(today + 'T12:00:00Z');
  const ws = new Date(d);
  ws.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const we = new Date(ws);
  we.setUTCDate(ws.getUTCDate() + 6);
  const weekFrom = ws.toISOString().slice(0, 10);
  const weekTo = we.toISOString().slice(0, 10);
  const monthFrom = today.slice(0, 8) + '01';
  const monthTo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const late = open.filter((t) => t.isLate).sort((a, b) => b.daysLate - a.daysLate);
  const week = open.filter((t) => !t.isLate && overlaps(t, weekFrom, weekTo));
  const month = open.filter((t) => !t.isLate && overlaps(t, monthFrom, monthTo));
  const unscheduled = open.filter((t) => !t.startDate);
  const upcoming = open.filter((t) => !t.isLate && !!t.startDate && t.startDate > weekTo).sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
  const done = tasks.filter(isDone);

  const tabs: [View, string, number][] = [
    ['week', 'هذا الأسبوع', week.length],
    ['month', `شهر ${MONTHS[Number(today.slice(5, 7))]}`, month.length],
    ['late', 'المتأخرة', late.length],
    ['upcoming', 'القادمة', upcoming.length],
    ['done', 'المكتملة', done.length],
  ];
  const grid = 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3';
  const list = (items: TaskCardData[]) => <div className={grid}>{items.map((t) => <TaskCard key={t.id} t={t} from={`/my-tasks?view=${view}`} />)}</div>;

  return (
    <>
      <PageHeader title="مهامي" sub={`مرحبًا ${profile.full_name}. هنا المهام المسندة إليك فقط، من الخطط المعتمدة.`} />
      {tasks.length === 0 ? (
        <EmptyState title="لا توجد مهام مسندة إليك" body="تظهر هنا المهام التي يسندها إليك مدير الإدارة بعد اعتماد الخطة." />
      ) : (
        <>
          <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1 shadow-[var(--shadow)] sm:w-fit" aria-label="العرض">
            {tabs.map(([k, l, n]) => (
              <Link
                key={k}
                href={`/my-tasks?view=${k}`}
                aria-current={view === k ? 'page' : undefined}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm', view === k ? 'bg-teal font-semibold text-white dark:text-[#04141b]' : 'text-muted hover:text-text')}
              >
                {l}
                <span className={cn('num rounded-full px-1.5 text-xs', view === k ? 'bg-white/20' : k === 'late' && n ? 'bg-orange-soft text-late' : 'bg-sunken')}>{n}</span>
              </Link>
            ))}
          </nav>

          {view === 'week' && (
            <div className="space-y-6">
              {late.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-late">متأخرة — أنجزها أولًا ({late.length})</h2>
                  {list(late.slice(0, 3))}
                  {late.length > 3 && (
                    <Link href="/my-tasks?view=late" className="mt-2 inline-block text-sm text-teal underline">
                      كل المتأخرة
                    </Link>
                  )}
                </section>
              )}
              <section>
                <h2 className="mb-2 text-sm font-semibold text-ink">مجدولة هذا الأسبوع</h2>
                {week.length ? list(week) : <EmptyState title="لا مهام هذا الأسبوع" body="اطّلع على القادمة أو مهام الشهر." />}
              </section>
            </div>
          )}
          {view === 'month' && (
            <div className="space-y-6">
              {month.length ? list(month) : <EmptyState title="لا مهام مفتوحة هذا الشهر" />}
              {unscheduled.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-late">بلا تاريخ — بانتظار تحديد موعدها</h2>
                  {list(unscheduled)}
                </section>
              )}
            </div>
          )}
          {view === 'late' && (late.length ? list(late) : <EmptyState title="لا مهام متأخرة" />)}
          {view === 'upcoming' && (upcoming.length ? list(upcoming) : <EmptyState title="لا مهام قادمة" />)}
          {view === 'done' && (done.length ? list(done) : <EmptyState title="لم تكتمل مهام بعد" />)}
        </>
      )}
    </>
  );
}
