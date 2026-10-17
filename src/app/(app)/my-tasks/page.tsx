import { CalendarClock, CalendarDays, CheckCheck, Hourglass, TriangleAlert } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, resolvePeriod } from '@/lib/data/common';
import { getBoundaries, loadStepsOnly } from '@/lib/data/plans';
import { overlaps, toTask } from '@/lib/data/tasks';
import { EmptyState, PageHeader, StatCard, Tabs } from '@/components/ui';
import { TaskCard } from '@/components/tasks/task-card';
import { MONTHS } from '@/lib/labels';
import { fmtDate } from '@/lib/format';
import type { WeekBoundary } from '@/lib/engine/types';

export const metadata = { title: 'مهامي' };

type View = 'week' | 'month' | 'late' | 'upcoming' | 'done';

function weekRange(today: string, b: WeekBoundary[]): [string, string] {
  const w = b.find((x) => x.start <= today && today <= x.end);
  if (w) return [w.start, w.end];
  // خارج حدود الأسابيع المعتمدة: من الأحد إلى السبت
  const d = new Date(today + 'T12:00:00Z');
  const s = new Date(d.getTime() - d.getUTCDay() * 86_400_000);
  const e = new Date(s.getTime() + 6 * 86_400_000);
  return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
}

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const period = await resolvePeriod(sb, {});
  const today = period.today;
  const [steps, depts] = await Promise.all([loadStepsOnly(sb, { assignee: profile.id }), getDepartments(sb, true)]);
  const active = steps.filter((s) => s.plan.status === 'approved' || s.plan.status === 'archived');

  const bCache = new Map<string, WeekBoundary[]>();
  for (const s of active) {
    const k = `${s.plan.year}-${s.plan.quarter}`;
    if (!bCache.has(k)) bCache.set(k, await getBoundaries(sb, s.plan.year, s.plan.quarter));
  }
  const curB = bCache.get(`${period.year}-${period.quarter}`) ?? (await getBoundaries(sb, period.year, period.quarter));
  const [wStart, wEnd] = weekRange(today, curB);
  const mStart = today.slice(0, 8) + '01';
  const mEndDate = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  const mEnd = mEndDate.toISOString().slice(0, 10);

  const tasks = active.map((s) =>
    toTask(s, {
      activityTitle: s.activityTitle,
      activityKind: s.activityKind,
      deptName: deptName(depts, s.plan.department_id, true),
      boundaries: bCache.get(`${s.plan.year}-${s.plan.quarter}`)!,
      asOf: today,
      canUpdate: s.plan.status === 'approved',
      departmentId: s.plan.department_id,
      viewerId: profile.id,
    }),
  );
  // المهمة الفردية «مكتملة» لي عندما أنجز نصيبي منها
  const doneForMe = (t: (typeof tasks)[number]) => (t.mode === 'individual' ? t.myStatus === 'completed' : t.status === 'completed');
  const open = tasks.filter((t) => !doneForMe(t));
  const byDue = (a: (typeof tasks)[number], b: (typeof tasks)[number]) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  const lists: Record<View, typeof tasks> = {
    late: open.filter((t) => t.dueDate && t.dueDate < today).sort((a, b) => b.daysLate - a.daysLate),
    week: open.filter((t) => overlaps(t.startDate, t.dueDate, wStart, wEnd) && !(t.dueDate! < today)).sort(byDue),
    month: open.filter((t) => overlaps(t.startDate, t.dueDate, mStart, mEnd) && !(t.dueDate! < today)).sort(byDue),
    upcoming: open.filter((t) => (t.startDate ?? t.dueDate ?? '') > wEnd || !t.dueDate).sort(byDue),
    done: tasks.filter(doneForMe).sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '')),
  };
  const view: View = (['week', 'month', 'late', 'upcoming', 'done'] as View[]).includes(sp.view as View) ? (sp.view as View) : lists.late.length && !lists.week.length ? 'late' : 'week';
  const curMonth = Number(today.slice(5, 7));
  const list = lists[view];

  const empty: Record<View, string> = {
    week: 'لا مهام مجدولة هذا الأسبوع',
    month: 'لا مهام مفتوحة هذا الشهر',
    late: 'لا مهام متأخرة — أحسنت',
    upcoming: 'لا مهام قادمة',
    done: 'لم تكتمل مهام بعد',
  };

  return (
    <>
      <PageHeader title="مهامي" sub={`مرحبًا ${profile.full_name}. هنا كل المهام المسندة إليك من الخطط التشغيلية المعتمدة.`} />
      {tasks.length === 0 ? (
        <EmptyState title="لا توجد مهام مسندة إليك" body="تظهر هنا المهام التي يسندها إليك مدير إدارتك أو المدير التنفيذي بعد اعتماد الخطة." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="هذا الأسبوع" value={lists.week.length} sub={`${fmtDate(wStart)} – ${fmtDate(wEnd)}`} icon={<CalendarClock size={20} />} href="/my-tasks?view=week" />
            <StatCard label="متأخرة" value={lists.late.length} tone={lists.late.length ? 'late' : undefined} sub="تبقى ظاهرة حتى تُنجز" icon={<TriangleAlert size={20} />} href="/my-tasks?view=late" />
            <StatCard label="قادمة" value={lists.upcoming.length} sub="بعد هذا الأسبوع" icon={<Hourglass size={20} />} href="/my-tasks?view=upcoming" />
            <StatCard label="مكتملة" value={lists.done.length} tone="done" sub={`من ${tasks.length} مهمة`} icon={<CheckCheck size={20} />} href="/my-tasks?view=done" />
          </div>
          <Tabs
            active={view}
            items={[
              { key: 'week', label: 'هذا الأسبوع', href: '/my-tasks?view=week', count: lists.week.length },
              { key: 'month', label: `شهر ${MONTHS[curMonth]}`, href: '/my-tasks?view=month', count: lists.month.length },
              { key: 'late', label: 'المتأخرة', href: '/my-tasks?view=late', count: lists.late.length, tone: 'late' },
              { key: 'upcoming', label: 'القادمة', href: '/my-tasks?view=upcoming', count: lists.upcoming.length },
              { key: 'done', label: 'المكتملة', href: '/my-tasks?view=done', count: lists.done.length },
            ]}
          />
          {view === 'week' && lists.late.length > 0 && (
            <a href="/my-tasks?view=late" className="mb-4 flex items-center gap-2 rounded-2xl bg-orange-soft px-4 py-3 text-sm text-late">
              <TriangleAlert size={16} /> لديك {lists.late.length} مهام متأخرة من أسابيع سابقة — اعرضها
            </a>
          )}
          {list.length ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {list.map((t) => (
                <TaskCard key={t.id} t={t} showDept from="my" />
              ))}
            </div>
          ) : (
            <EmptyState title={empty[view]} icon={<CalendarDays size={26} />} />
          )}
        </>
      )}
    </>
  );
}
