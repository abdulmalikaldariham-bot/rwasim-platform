import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { getBoundaries, loadActivities } from '@/lib/data/plans';
import { evaluateStep, todayISO } from '@/lib/engine/progress';
import { stepFact } from '@/lib/data/plans';
import { KIND_LABELS } from '@/lib/engine/weights';
import { AvatarStack, PageHeader, Panel, PanelHead, Pill, ProgressBar, stateTone, Notice, StatCard } from '@/components/ui';
import { TaskUpdater } from '@/components/tasks/task-updater';
import { EvidenceLink } from '@/components/tasks/small-controls';
import { AssigneePicker } from '@/components/tasks/assignee-picker';
import { CalendarRange, Target, Star } from 'lucide-react';
import { ACTIVITY_STATE, MONTHS, PLAN_STATUS, QUARTER_LABEL, ROLE_LABELS, STEP_STATUS, TIMING } from '@/lib/labels';
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
  const today = todayISO();

  const [{ data: updates }, { data: evidence }, { data: people }, kpi] = await Promise.all([
    sb.from('step_updates').select('id,step_id,created_at,note,from_status,to_status,to_progress,profiles(full_name)').in('step_id', a.steps.map((s) => s.id)).order('created_at', { ascending: false }).limit(30),
    sb.from('evidence').select('id,step_id,kind,url,file_name,storage_path,created_at,note').in('step_id', a.steps.map((s) => s.id)).order('created_at', { ascending: false }),
    isManager
      ? (() => {
          let q = sb.from('profiles').select('id,full_name,role,department_id,job_title').eq('is_active', true).in('role', ['employee', 'dept_manager', 'executive_director']).order('full_name');
          if (profile.role !== 'executive_director') q = q.eq('department_id', plan.department_id);
          return q;
        })()
      : Promise.resolve({ data: [] as { id: string; full_name: string; role: string; department_id: string | null; job_title: string | null }[] }),
    act.kpi_id ? sb.from('kpis').select('id,name').eq('id', act.kpi_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canUpdateStep = (st: (typeof a.steps)[number]) => plan.status === 'approved' && (isManager || st.assignees.some((x) => x.user_id === profile.id));
  const pickerPeople = (people ?? []).map((p) => ({ id: p.id, name: p.full_name, sub: `${ROLE_LABELS[p.role]}${p.job_title ? ` · ${p.job_title}` : ''}`, inDept: p.department_id === plan.department_id && p.role !== 'executive_director' }));
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
              {a.eval.stepsCompleted}/{a.eval.stepsTotal} مهام
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

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="المهام التنفيذية" value={a.eval.stepsTotal} sub="داخل هذا العمل" />
        <StatCard label="المهام المكتملة" value={a.eval.stepsCompleted} tone="done" />
        <StatCard label="المهام المتأخرة" value={a.eval.lateSteps} tone={a.eval.lateSteps ? 'late' : undefined} />
        <StatCard label="المكلفون" value={new Set(a.steps.flatMap((x) => x.assignees.map((y) => y.user_id))).size} sub="أشخاص مختلفون" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Panel>
          <PanelHead title="المهام التنفيذية" hint="اضغط على المهمة لعرض تفاصيلها ومخرجاتها" />
          <ol className="divide-y divide-line">
            {a.steps.map((s) => {
              const e = evaluateStep(stepFact(s), b, today);
              const tone = s.status === 'completed' ? 'done' : e.isLate ? 'late' : stateTone(s.status);
              const ev = (evidence ?? []).filter((x) => x.step_id === s.id);
              return (
                <li key={s.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${s.id}`} className="font-bold text-ink hover:text-teal">
                        {s.title}
                        {s.is_core && <Star size={13} className="ms-1.5 inline -translate-y-0.5 fill-orange text-orange" aria-label="المهمة الجوهرية" />}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                        <span className="flex items-center gap-1">
                          <CalendarRange size={14} />
                          {s.planned_end ? `${fmtDate(s.planned_start)} – ${fmtDate(s.planned_end)}` : <span className="text-late">بلا تاريخ — للمراجعة</span>}
                        </span>
                        {s.assignees.length ? (
                          <span className="flex items-center gap-2">
                            <AvatarStack names={s.assignees.map((x) => x.name)} size={22} />
                            <span className="text-xs">{s.assignees.length === 1 ? s.assignees[0].name : `${s.assignees.length} مكلفين${s.assignment_mode === 'individual' ? ' · فردية' : ''}`}</span>
                          </span>
                        ) : (
                          <span className="text-xs">{s.responsible_text ? `المسؤول: ${s.responsible_text}` : 'غير مسندة'}</span>
                        )}
                      </div>
                      {s.output && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-sunken/70 px-3 py-1.5 text-sm">
                          <Target size={14} className="mt-1 shrink-0 text-late" />
                          <span>
                            <span className="font-semibold text-late">المخرج المطلوب: </span>
                            {s.output}
                            {s.actual_output && <span className="block text-done">المتحقق: {s.actual_output}</span>}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Pill tone={tone}>{STEP_STATUS[s.status]}</Pill>
                      {e.timing !== 'done' && <Pill tone={e.timing === 'overdue' ? 'late' : e.timing === 'in_window' ? 'teal' : 'nodata'}>{e.timing === 'overdue' ? `متأخرة ${e.daysLate} يومًا` : TIMING[e.timing]}</Pill>}
                      {showWeights && <span className="num text-xs text-muted">الوزن {fmtPct(s.weight)}</span>}
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
                      {isManager && plan.status !== 'archived' && (
                        <AssigneePicker
                          trigger="link"
                          stepId={s.id}
                          hasSubsteps={s.substeps.length > 0}
                          people={pickerPeople}
                          current={{ userIds: s.assignees.map((x) => x.user_id), leadId: s.assignees.find((x) => x.is_lead)?.user_id ?? null, mode: s.assignment_mode, threshold: s.completion_threshold, allDept: s.assign_scope === 'all_dept' }}
                        />
                      )}
                      {canUpdateStep(s) && (
                        <TaskUpdater
                          compact
                          departmentId={plan.department_id}
                          step={{ ...s, actualOutput: s.actual_output, outputRequirement: s.output_requirement, mode: s.assignment_mode, myStatus: s.assignees.find((x) => x.user_id === profile.id)?.status ?? null, myOutput: s.assignees.find((x) => x.user_id === profile.id)?.output_note ?? null, isAssignee: s.assignees.some((x) => x.user_id === profile.id) }}
                        />
                      )}
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
                        <EvidenceLink key={x.id} path={x.storage_path} url={x.kind === 'link' ? x.url : null} name={x.file_name} />
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
