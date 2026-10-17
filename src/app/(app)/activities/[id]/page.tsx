import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { getBoundaries, loadActivities } from '@/lib/data/plans';
import { evaluateStep } from '@/lib/engine/progress';
import { KIND_LABELS } from '@/lib/engine/weights';
import { PageHeader, Panel, PanelHead, Pill, ProgressBar, stateTone, Notice } from '@/components/ui';
import { TaskUpdater } from '@/components/tasks/task-updater';
import { AssignSelect, EvidenceLink } from '@/components/tasks/small-controls';
import { ACTIVITY_STATE, MONTHS, PLAN_STATUS, QUARTER_LABEL, STEP_STATUS } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format';

export default async function ActivityDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ weights?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const { data: act } = await sb.from('activities').select('id,plan_id,kpi_id,op_plans(id,year,quarter,department_id,status)').eq('id', id).maybeSingle();
  if (!act) notFound();
   
  const plan = (act as any).op_plans as { id: string; year: number; quarter: number; department_id: string; status: string };
  const b = await getBoundaries(sb, plan.year, plan.quarter);
  const [a] = await loadActivities(sb, [plan.id], { [plan.id]: b }).then((x) => x.filter((y) => y.id === id));
  if (!a) notFound();
  const depts = await getDepartments(sb, true);
  const showWeights = sp.weights === '1';
  const isManager = profile.role === 'executive_director' || (profile.role === 'dept_manager' && profile.department_id === plan.department_id);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: updates }, { data: evidence }, { data: people }, kpi] = await Promise.all([
    sb.from('step_updates').select('id,step_id,created_at,note,from_status,to_status,to_progress,profiles(full_name)').in('step_id', a.steps.map((s) => s.id)).order('created_at', { ascending: false }).limit(30),
    sb.from('evidence').select('id,step_id,file_name,storage_path,created_at,note').in('step_id', a.steps.map((s) => s.id)).order('created_at', { ascending: false }),
    isManager ? sb.from('profiles').select('id,full_name').eq('department_id', plan.department_id).eq('is_active', true).order('full_name') : Promise.resolve({ data: [] }),
    act.kpi_id ? sb.from('kpis').select('id,name').eq('id', act.kpi_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canUpdateStep = (assignee: string | null) => plan.status === 'approved' && (isManager || assignee === profile.id);
  const months = [...new Set(b.map((w) => w.month))];

  return (
    <>
      <PageHeader
        back={{ href: `/dashboard/department/${plan.department_id}?year=${plan.year}&q=${plan.quarter}`, label: deptName(depts, plan.department_id) }}
        title={a.title}
        sub={`${KIND_LABELS[a.kind]} — ${QUARTER_LABEL[plan.quarter]} ${plan.year}م${plan.status !== 'approved' ? ` — الخطة ${PLAN_STATUS[plan.status as 'draft']}` : ''}`}
        actions={
          <Link href={`?${showWeights ? '' : 'weights=1'}`} className="text-sm text-teal underline">
            {showWeights ? 'إخفاء الأوزان' : 'إظهار الأوزان'}
          </Link>
        }
      />
      <Panel className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <p className="text-sm text-muted">الإنجاز</p>
            <p className="num text-4xl font-bold text-ink" style={{ textAlign: 'right' }}>{fmtPct(a.eval.progress)}</p>
          </div>
          <div className="min-w-56 flex-1">
            <ProgressBar value={a.eval.progress} planned={a.eval.planned} size="lg" tone={stateTone(a.eval.state) === 'nodata' ? 'teal' : stateTone(a.eval.state)} />
            <p className="mt-1.5 text-xs text-muted">المخطط حتى اليوم {fmtPct(a.eval.planned)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone={stateTone(a.eval.state)}>{ACTIVITY_STATE[a.eval.state]}</Pill>
            <Pill>
              {a.eval.stepsCompleted}/{a.eval.stepsTotal} خطوات
            </Pill>
            <Pill>حتى {fmtDate(a.eval.dueDate)}</Pill>
            {showWeights && <Pill tone="teal">وزنه في خطة الإدارة {fmtPct(a.weight)}</Pill>}
          </div>
        </div>
        {kpi.data && (
          <p className="mt-4 text-sm text-muted">
            مرتبط بالمؤشر:{' '}
            <Link className="text-teal underline" href={`/dashboard/kpi/${kpi.data.id}`}>
              {kpi.data.name}
            </Link>
          </p>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Panel>
          <PanelHead title="الخطوات التنفيذية" hint="الشريط الصغير يوضح أسابيع التنفيذ المخططة خلال الربع" />
          <ol className="divide-y divide-line">
            {a.steps.map((s) => {
              const e = evaluateStep({ id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks }, b, today);
              const tone = s.status === 'completed' ? 'done' : e.isLate ? 'late' : stateTone(s.status);
              const ev = (evidence ?? []).filter((x) => x.step_id === s.id);
              return (
                <li key={s.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {s.title}
                        {s.is_core && <span className="ms-2 rounded bg-orange-soft px-1.5 py-0.5 text-[11px] font-medium text-late">الخطوة الجوهرية</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {s.assigneeName ? `${s.assigneeName} (مفوض)` : s.responsible_text ?? 'بلا مسؤول'} — المخرج: {s.output ?? 'غير محدد'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {showWeights && <span className="num text-xs text-muted">الوزن {fmtPct(s.weight)}</span>}
                      <Pill tone={tone}>{e.isLate && s.status !== 'completed' ? `متأخرة ${e.daysLate} يومًا` : STEP_STATUS[s.status]}</Pill>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-0.5" dir="rtl" aria-label="الجدولة الأسبوعية">
                      {b.map((w) => (
                        <span
                          key={w.weekIndex}
                          title={`${MONTHS[w.month]} — الأسبوع ${w.weekOfMonth}${s.intensities[w.weekIndex] ? ` (${s.intensities[w.weekIndex]})` : ''}`}
                          className={`h-3 w-4 ${w.weekOfMonth === 1 && w.weekIndex > 1 ? 'ms-1' : ''} rounded-sm`}
                          style={{
                            background: s.weeks.includes(w.weekIndex) ? (s.status === 'completed' ? 'var(--done)' : e.isLate ? 'var(--orange)' : 'var(--teal)') : 'var(--sunken)',
                            outline: w.start <= today && today <= w.end ? '2px solid var(--ink)' : undefined,
                          }}
                        />
                      ))}
                      <span className="ms-2 text-xs text-muted">{MONTHS[months[0]]} – {MONTHS[months[months.length - 1]]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isManager && plan.status !== 'archived' && <AssignSelect stepId={s.id} value={s.assignee_id} people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name }))} />}
                      {canUpdateStep(s.assignee_id) && <TaskUpdater step={s} departmentId={plan.department_id} compact />}
                    </div>
                  </div>
                  {s.substeps.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.substeps.map((x) => (
                        <li key={x.id} className={`rounded-full px-2.5 py-0.5 text-xs ${x.is_done ? 'bg-done-soft text-done' : 'bg-sunken text-muted'}`}>
                          {x.is_done ? '✓ ' : ''}
                          {x.title}
                          {showWeights ? ` (${fmtPct(x.weight)})` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {ev.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {ev.map((x) => (
                        <EvidenceLink key={x.id} path={x.storage_path} name={x.file_name} />
                      ))}
                    </div>
                  )}
                  {s.import_followup && (
                    <p className="mt-2 text-xs text-muted">
                      ملاحظة المتابعة في ملف Excel: «{s.import_followup}» — للاطلاع فقط ولم تُحتسب.
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
        <aside className="space-y-4">
          {plan.status !== 'approved' && <Notice tone="nodata">تحديث الإنجاز متاح بعد اعتماد الخطة.</Notice>}
          <Panel>
            <PanelHead title="سجل التحديثات والملاحظات" />
            <ul className="space-y-3 px-5 pb-5">
              {(updates ?? []).length === 0 && <li className="text-sm text-muted">لا تحديثات بعد.</li>}
              { }
              {(updates ?? []).map((u: any) => (
                <li key={u.id} className="border-s-2 border-line ps-3 text-sm">
                  <p className="font-medium text-ink">{a.steps.find((s) => s.id === u.step_id)?.title}</p>
                  <p className="text-muted">
                    {u.profiles?.full_name} — {u.from_status === u.to_status ? 'ملاحظة' : STEP_STATUS[u.to_status as 'completed']}
                    {u.to_progress !== null && u.from_status !== u.to_status ? ` (${fmtPct(Number(u.to_progress))})` : ''}
                  </p>
                  {u.note && <p className="mt-1 rounded bg-sunken px-2 py-1">{u.note}</p>}
                  <p className="text-xs text-muted">{fmtDateTime(u.created_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
