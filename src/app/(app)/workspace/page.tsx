import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getDepartments, resolvePeriod, getSetting } from '@/lib/data/common';
import { getBoundaries, loadActivities, stepFact, type PlanRow } from '@/lib/data/plans';
import { toTask } from '@/lib/data/tasks';
import { evaluateDepartment, currentWeekIndex, effectiveWeeks } from '@/lib/engine/progress';
import { PageHeader, Panel, PanelHead, EmptyState, ButtonLink, ProgressBar, Pill, Notice, stateTone } from '@/components/ui';
import { TaskCard } from '@/components/tasks/task-card';
import { WorkspaceFilters } from './filters';
import { ACTIVITY_STATE, DATA_STATE, MONTHS, PLAN_STATUS, QUARTER_LABEL } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format';

export const metadata = { title: 'مساحة عمل الإدارة' };

type SP = { dept?: string; view?: string; who?: string; year?: string; q?: string; m?: string };

export default async function Workspace({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession(['dept_manager', 'executive_director']);
  const period = await resolvePeriod(sb, sp);
  const depts = await getDepartments(sb);
  const isEd = profile.role === 'executive_director';
  const deptId = isEd ? sp.dept ?? depts[0]?.id : profile.department_id;
  const dept = depts.find((d) => d.id === deptId);
  if (!dept) return <EmptyState title="لم تُحدَّد إدارتك بعد" body="اطلب من مسؤول النظام ربط حسابك بإدارة." />;

  const view = sp.view === 'month' ? 'month' : sp.view === 'late' ? 'late' : sp.view === 'activities' ? 'activities' : 'week';
  const { data: planData } = await sb.from('op_plans').select('*').eq('year', period.year).eq('quarter', period.quarter).eq('department_id', dept.id).maybeSingle();
  const plan = planData as PlanRow | null;
  const deptSwitcher = isEd ? (
    <div className="flex flex-wrap gap-1.5">
      {depts.map((d) => (
        <Link
          key={d.id}
          href={`/workspace?dept=${d.id}&year=${period.year}&q=${period.quarter}`}
          className={`rounded-full border px-3 py-1 text-sm ${d.id === dept.id ? 'border-teal bg-teal-soft font-semibold text-teal' : 'border-line text-muted hover:text-text'}`}
        >
          {d.short_name ?? d.name}
        </Link>
      ))}
    </div>
  ) : null;

  const header = (
    <PageHeader
      title={isEd ? `مساحة عمل ${dept.name}` : 'مساحة عمل الإدارة'}
      sub={`${dept.name} — ${QUARTER_LABEL[period.quarter]} ${period.year}م`}
      actions={plan ? <ButtonLink variant="secondary" href={`/plans/${plan.id}`}>الخطة كاملة</ButtonLink> : undefined}
    />
  );

  if (!plan || (plan.status !== 'approved' && plan.status !== 'archived')) {
    return (
      <>
        {header}
        {deptSwitcher && <div className="mb-6">{deptSwitcher}</div>}
        <EmptyState
          title={plan ? `خطة الربع ${PLAN_STATUS[plan.status]}` : 'لا توجد خطة تشغيلية لهذا الربع'}
          body={plan ? 'تظهر المهام هنا تلقائيًا بعد اعتماد الخطة.' : 'استورد خطة الإدارة من Excel أو أنشئها يدويًا، ثم اضبط الأوزان وارفعها للاعتماد.'}
          action={<ButtonLink href={plan ? `/plans/${plan.id}` : `/plans/import?year=${period.year}&q=${period.quarter}`}>{plan ? 'فتح الخطة' : 'استيراد خطة'}</ButtonLink>}
        />
      </>
    );
  }

  const boundaries = await getBoundaries(sb, plan.year, plan.quarter);
  const activities = await loadActivities(sb, [plan.id], { [plan.id]: boundaries }, period.today);
  const staleDays = await getSetting<number>(sb, 'stale_after_days', 14);
  const deptEval = evaluateDepartment(
    dept.id,
    {
      id: plan.id,
      departmentId: dept.id,
      quarter: plan.quarter,
      status: plan.status,
      activities: activities.map((a) => ({ id: a.id, weight: a.weight, steps: a.steps.map(stepFact) })),
    },
    boundaries,
    { asOf: period.today, staleAfterDays: staleDays },
  );

  const canUpdate = plan.status === 'approved';
  const tasks = activities.flatMap((a) => a.steps.map((s) => ({ step: s, weeks: effectiveWeeks(stepFact(s), boundaries), task: toTask(s, { activityTitle: a.title, boundaries, asOf: period.today, canUpdate, departmentId: dept.id }) })));
  const people = [...new Set(tasks.map((t) => t.task.assigneeName ?? t.task.responsible).filter(Boolean) as string[])].sort();
  const who = sp.who && people.includes(sp.who) ? sp.who : null;
  const filtered = who ? tasks.filter((t) => (t.task.assigneeName ?? t.task.responsible) === who || (t.task.responsible ?? '').includes(who)) : tasks;

  const curWeek = currentWeekIndex(boundaries, period.today);
  const qEnded = boundaries.at(-1)!.end < period.today;
  const late = filtered.filter((t) => t.task.isLate && t.step.status !== 'completed').sort((a, b) => b.task.daysLate - a.task.daysLate);
  const thisWeek = curWeek ? filtered.filter((t) => t.weeks.includes(curWeek) && !(t.task.isLate && t.step.status !== 'completed')) : [];
  const months = [...new Set(boundaries.map((b) => b.month))];
  const curMonth = boundaries.find((b) => b.weekIndex === curWeek)?.month;
  const month = Number(sp.m) && months.includes(Number(sp.m)) ? Number(sp.m) : curMonth ?? months[0];

  const { data: updates } = await sb
    .from('step_updates')
    .select('id,created_at,note,to_status,from_status,to_progress,steps(title),profiles(full_name)')
    .eq('plan_id', plan.id)
    .order('created_at', { ascending: false })
    .limit(8);

  const base = `/workspace?${new URLSearchParams({ ...(isEd ? { dept: dept.id } : {}), year: String(period.year), q: String(period.quarter), ...(who ? { who } : {}) })}`;

  return (
    <>
      {header}
      {deptSwitcher && <div className="mb-6">{deptSwitcher}</div>}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Panel className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">إنجاز خطة الإدارة</p>
              <p className="num text-4xl font-bold text-ink" style={{ textAlign: 'right' }}>{fmtPct(deptEval.progress)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone="teal">{deptEval.activitiesInProgress} جارية</Pill>
              <Pill tone="done">{deptEval.activitiesCompleted} مكتملة</Pill>
              {deptEval.activitiesLate > 0 && <Pill tone="late">{deptEval.activitiesLate} متأخرة</Pill>}
              {deptEval.activitiesStalled > 0 && <Pill tone="stalled">{deptEval.activitiesStalled} متعثرة</Pill>}
              {deptEval.dataState !== 'ok' && <Pill tone={stateTone(deptEval.dataState)}>{DATA_STATE[deptEval.dataState]}</Pill>}
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={deptEval.progress} planned={deptEval.planned} size="lg" label="إنجاز الإدارة" />
            <p className="mt-1.5 text-xs text-muted">
              العلامة = المخطط حتى اليوم ({fmtPct(deptEval.planned)}) — آخر تحديث {fmtDateTime(deptEval.lastUpdateAt)}
            </p>
          </div>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm text-muted">اليوم</p>
          <p className="text-lg font-semibold text-ink">{fmtDate(period.today)}</p>
          <p className="mt-1 text-sm text-muted">
            {qEnded ? 'انتهى هذا الربع' : curWeek ? `${MONTHS[boundaries.find((b) => b.weekIndex === curWeek)!.month]} — الأسبوع ${boundaries.find((b) => b.weekIndex === curWeek)!.weekOfMonth}` : 'خارج أسابيع الربع'}
          </p>
          <p className="mt-3 text-sm">
            <span className="num font-bold text-ink">{thisWeek.filter((t) => t.step.status !== 'completed').length}</span> مهام هذا الأسبوع،{' '}
            <span className="num font-bold text-late">{late.length}</span> متأخرة
          </p>
        </Panel>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="العرض">
          {[
            ['week', 'هذا الأسبوع'],
            ['month', 'الشهر'],
            ['late', `المتأخرة (${late.length})`],
            ['activities', 'الأنشطة'],
          ].map(([k, l]) => (
            <Link key={k} href={`${base}&view=${k}`} aria-current={view === k ? 'page' : undefined} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${view === k ? 'bg-teal font-semibold text-white dark:text-[#04141b]' : 'text-muted hover:text-text'}`}>
              {l}
            </Link>
          ))}
        </nav>
        <WorkspaceFilters people={people} who={who} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          {view === 'week' && (
            <div className="space-y-5">
              {late.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-late">متأخرة من أسابيع سابقة ({late.length})</h2>
                  <div className="grid gap-3 md:grid-cols-2">{late.slice(0, 4).map((t) => <TaskCard key={t.task.id} t={t.task} from="/workspace" />)}</div>
                  {late.length > 4 && (
                    <Link href={`${base}&view=late`} className="mt-2 inline-block text-sm text-teal underline">
                      عرض كل المتأخرة
                    </Link>
                  )}
                </section>
              )}
              <section>
                <h2 className="mb-2 text-sm font-semibold text-ink">مجدولة هذا الأسبوع ({thisWeek.length})</h2>
                {thisWeek.length ? (
                  <div className="grid gap-3 md:grid-cols-2">{thisWeek.map((t) => <TaskCard key={t.task.id} t={t.task} from="/workspace" />)}</div>
                ) : (
                  <EmptyState title={qEnded ? 'انتهى الربع' : 'لا مهام مجدولة هذا الأسبوع'} body="اطّلع على عرض الشهر لمعرفة ما هو قادم." />
                )}
              </section>
            </div>
          )}

          {view === 'month' && (
            <section>
              <div className="mb-3 flex gap-1.5">
                {months.map((m) => (
                  <Link key={m} href={`${base}&view=month&m=${m}`} className={`rounded-full border px-3 py-1 text-sm ${m === month ? 'border-orange bg-orange-soft font-semibold text-ink' : 'border-line text-muted'}`}>
                    {MONTHS[m]}
                  </Link>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                {boundaries
                  .filter((b) => b.month === month)
                  .map((b) => {
                    const items = filtered.filter((t) => t.weeks.includes(b.weekIndex));
                    const isNow = b.weekIndex === curWeek;
                    return (
                      <div key={b.weekIndex} className={`rounded-xl border p-3 ${isNow ? 'border-orange bg-orange-soft/40' : 'border-line bg-surface'}`}>
                        <div className="mb-2 flex items-baseline justify-between">
                          <h3 className="font-semibold text-ink">الأسبوع {b.weekOfMonth}</h3>
                          <span className="text-xs text-muted">
                            {fmtDate(b.start)} – {fmtDate(b.end)}
                          </span>
                        </div>
                        {isNow && <p className="mb-2 text-xs font-medium text-late">الأسبوع الحالي</p>}
                        <ul className="space-y-2">
                          {items.length === 0 && <li className="text-sm text-muted">لا مهام</li>}
                          {items.map((t) => (
                            <li key={t.task.id} className="rounded-lg border border-line bg-surface p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-medium leading-snug">{t.step.title}</p>
                                <span
                                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                  title={t.step.status}
                                  style={{ background: t.step.status === 'completed' ? 'var(--done)' : t.task.isLate ? 'var(--late)' : t.step.status === 'in_progress' ? 'var(--teal)' : 'var(--nodata)' }}
                                />
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted">{t.task.activityTitle}</p>
                              <p className="truncate text-xs text-muted">{t.task.assigneeName ?? t.task.responsible}</p>
                              {t.weeks.length > 1 && <p className="mt-1 text-[11px] text-teal">مهمة واحدة ممتدة {t.weeks.length} أسابيع</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {view === 'late' && (
            <section>
              {late.length ? (
                <div className="grid gap-3 md:grid-cols-2">{late.map((t) => <TaskCard key={t.task.id} t={t.task} from="/workspace" />)}</div>
              ) : (
                <EmptyState title="لا توجد مهام متأخرة" body="كل المهام التي انتهى موعدها مكتملة." />
              )}
            </section>
          )}

          {view === 'activities' && (
            <div className="grid gap-3 md:grid-cols-2">
              {activities.map((a) => (
                <Link key={a.id} href={`/activities/${a.id}`} className="card p-4 hover:border-teal">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-ink">{a.title}</h3>
                    <Pill tone={stateTone(a.eval.state)}>{ACTIVITY_STATE[a.eval.state]}</Pill>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <ProgressBar value={a.eval.progress} planned={a.eval.planned} tone={stateTone(a.eval.state) === 'nodata' ? 'teal' : stateTone(a.eval.state)} />
                    <span className="num w-14 text-sm font-semibold">{fmtPct(a.eval.progress)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {a.eval.stepsCompleted} من {a.eval.stepsTotal} مهام — حتى {fmtDate(a.eval.dueDate)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside>
          <Panel>
            <PanelHead title="آخر التحديثات" />
            <ul className="space-y-3 px-5 pb-5">
              {(updates ?? []).length === 0 && <li className="text-sm text-muted">لم تُسجل تحديثات بعد.</li>}
              { }
              {(updates ?? []).map((u: any) => (
                <li key={u.id} className="text-sm">
                  <p className="font-medium text-ink">{u.steps?.title}</p>
                  <p className="text-muted">
                    {u.profiles?.full_name ?? '—'} — {u.from_status === u.to_status ? 'ملاحظة' : `إلى «${{ completed: 'مكتملة', in_progress: 'جارية', on_hold: 'معلّقة', not_started: 'لم تبدأ' }[u.to_status as string]}»`}
                  </p>
                  {u.note && <p className="mt-0.5 rounded bg-sunken px-2 py-1 text-xs">{u.note}</p>}
                  <p className="text-xs text-muted">{fmtDateTime(u.created_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
          {plan.status === 'approved' && (
            <Notice tone="nodata" title="تعثر يحتاج قرارًا؟">
              من نافذة «تحديث» على أي مهمة يمكنك رفع التعثر للمدير التنفيذي مع ملاحظة.
            </Notice>
          )}
        </aside>
      </div>
    </>
  );
}
