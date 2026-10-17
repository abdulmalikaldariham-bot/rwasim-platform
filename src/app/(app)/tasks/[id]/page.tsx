import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarRange, CheckCircle2, Crown, Paperclip, Star, Target } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { getBoundaries, loadStepsOnly } from '@/lib/data/plans';
import { evaluateStep, todayISO } from '@/lib/engine/progress';
import { KIND_LABELS } from '@/lib/engine/weights';
import { Avatar, Notice, PageHeader, Panel, PanelHead, Pill, ProgressBar, stateTone } from '@/components/ui';
import { TaskUpdater } from '@/components/tasks/task-updater';
import { AssigneePicker } from '@/components/tasks/assignee-picker';
import { AssigneeStatusSelect, DatesEditor, EvidenceLink, OutputRequirementSelect } from '@/components/tasks/small-controls';
import { ASSIGN_MODE, OUTPUT_REQUIREMENT, PLAN_STATUS, ROLE_LABELS, STEP_STATUS, TIMING, MONTHS } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format';

export const metadata = { title: 'تفاصيل المهمة' };

export default async function TaskDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const [s] = await loadStepsOnly(sb, { stepIds: [id] });
  if (!s) notFound();
  const b = await getBoundaries(sb, s.plan.year, s.plan.quarter);
  const today = todayISO();
  const e = evaluateStep({ id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks, plannedStart: s.planned_start, plannedEnd: s.planned_end }, b, today);
  const depts = await getDepartments(sb, true);
  const isEd = profile.role === 'executive_director';
  const isManager = isEd || (profile.role === 'dept_manager' && profile.department_id === s.plan.department_id);
  const mine = s.assignees.find((a) => a.user_id === profile.id);
  const approved = s.plan.status === 'approved';
  const canUpdate = approved && (isManager || !!mine);
  const canManage = isManager && s.plan.status !== 'archived';

  const [{ data: evidence }, { data: updates }, { data: people }] = await Promise.all([
    sb.from('evidence').select('id,kind,file_name,storage_path,url,note,created_at,uploaded_by,profiles!evidence_uploaded_by_fkey(full_name)').eq('step_id', id).order('created_at', { ascending: false }),
    sb.from('step_updates').select('id,created_at,note,from_status,to_status,to_progress,actual_output,profiles(full_name)').eq('step_id', id).order('created_at', { ascending: false }).limit(40),
    canManage
      ? (() => {
          let q = sb.from('profiles').select('id,full_name,role,department_id,job_title').eq('is_active', true).in('role', ['employee', 'dept_manager', 'executive_director']).order('full_name');
          if (!isEd) q = q.eq('department_id', s.plan.department_id);
          return q;
        })()
      : Promise.resolve({ data: [] as { id: string; full_name: string; role: string; department_id: string | null; job_title: string | null }[] }),
  ]);
  const individual = s.assignment_mode === 'individual';
  const doneCount = s.assignees.filter((a) => a.status === 'completed').length;
  const back = sp.from === 'my' ? { href: '/my-tasks', label: 'مهامي' } : { href: `/activities/${s.activity_id}`, label: s.activityTitle };

  return (
    <>
      <PageHeader
        back={back}
        eyebrow={`${s.activityKind === 'project' ? 'مشروع' : KIND_LABELS[s.activityKind] ?? 'نشاط'}: ${s.activityTitle} · ${deptName(depts, s.plan.department_id)}`}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.title}
            {s.is_core && (
              <Pill tone="orange">
                <Star size={12} className="fill-current" /> المهمة الجوهرية
              </Pill>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Pill tone={stateTone(s.status)}>{STEP_STATUS[s.status]}</Pill>
            <Pill tone={e.timing === 'overdue' ? 'late' : e.timing === 'in_window' ? 'teal' : e.timing === 'done' ? 'done' : 'nodata'}>
              {e.timing === 'overdue' ? `متأخرة ${e.daysLate} يومًا` : TIMING[e.timing]}
            </Pill>
          </div>
        }
      />
      {!approved && <div className="mb-5"><Notice tone="nodata">الخطة {PLAN_STATUS[s.plan.status]} — تسجيل الإنجاز متاح بعد اعتمادها.</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* المخرجات: أبرز ما في المهمة */}
          <Panel className="overflow-hidden">
            <div className="grid md:grid-cols-2">
              <div className="border-b border-line p-5 md:border-b-0 md:border-l">
                <p className="flex items-center gap-1.5 text-sm font-bold text-late">
                  <Target size={16} /> المخرج المطلوب
                </p>
                <p className="mt-2 text-[1.05rem] leading-relaxed text-ink">{s.output ?? <span className="text-muted">لم يُحدد مخرج في الخطة</span>}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
                  شرط الإغلاق:
                  {canManage ? <OutputRequirementSelect stepId={s.id} value={s.output_requirement} /> : <span className="font-semibold text-text">{OUTPUT_REQUIREMENT[s.output_requirement]}</span>}
                </div>
              </div>
              <div className="p-5">
                <p className="flex items-center gap-1.5 text-sm font-bold text-done">
                  <CheckCircle2 size={16} /> المخرج المتحقق
                </p>
                {individual ? (
                  <ul className="mt-2 space-y-2 text-sm">
                    {s.assignees.filter((a) => a.output_note).length === 0 && <li className="text-muted">لم يسجل المكلفون مخرجاتهم بعد.</li>}
                    {s.assignees
                      .filter((a) => a.output_note)
                      .map((a) => (
                        <li key={a.user_id} className="rounded-xl bg-sunken px-3 py-2">
                          <span className="font-semibold">{a.name}: </span>
                          {a.output_note}
                        </li>
                      ))}
                  </ul>
                ) : s.actual_output ? (
                  <p className="mt-2 text-[1.05rem] leading-relaxed text-ink">{s.actual_output}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted">لم يُسجل بعد. يُطلب عند إكمال المهمة.</p>
                )}
                <div className="mt-4">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Paperclip size={13} /> الشواهد ({(evidence ?? []).length})
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(evidence ?? []).map((x: any) => (
                      <div key={x.id} className="text-sm">
                        <EvidenceLink id={x.id} path={x.storage_path} url={x.kind === 'link' ? x.url : null} name={x.file_name} canDelete={isEd || (x.uploaded_by === profile.id && canUpdate)} />
                        <span className="ms-2 text-xs text-muted">
                          {x.profiles?.full_name} · {fmtDate(x.created_at)}
                        </span>
                        {x.note && <p className="text-xs text-muted">{x.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {canUpdate && (
            <Panel>
              <PanelHead title={individual && mine ? 'سجّل إنجازك' : 'تحديث المهمة'} hint="الحالة، والمخرج المتحقق، والشاهد في خطوة واحدة" />
              <div className="px-5 pb-5">
                {individual && !mine ? (
                  <p className="text-sm text-muted">هذه مهمة فردية؛ حدّث حالة كل مكلف من قائمة المكلفين.</p>
                ) : (
                  <TaskUpdater
                    inline
                    departmentId={s.plan.department_id}
                    step={{
                      id: s.id,
                      title: s.title,
                      status: s.status,
                      output: null,
                      actualOutput: s.actual_output,
                      outputRequirement: s.output_requirement,
                      substeps: s.substeps,
                      mode: s.assignment_mode,
                      myStatus: mine?.status ?? null,
                      myOutput: mine?.output_note ?? null,
                      isAssignee: !!mine,
                    }}
                  />
                )}
              </div>
            </Panel>
          )}

          {s.substeps.length > 0 && (
            <Panel>
              <PanelHead title="المراحل الفرعية" hint={`إنجاز المهمة ${fmtPct(s.progress)}`} />
              <ul className="flex flex-wrap gap-2 px-5 pb-5">
                {s.substeps.map((x) => (
                  <li key={x.id} className={`rounded-full px-3 py-1 text-sm ${x.is_done ? 'bg-done-soft text-done' : 'bg-sunken text-muted'}`}>
                    {x.is_done ? '✓ ' : ''}
                    {x.title} <span className="num text-xs">({fmtPct(x.weight)})</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel>
            <PanelHead title="سجل المهمة" hint="كل تحديث ومن قام به" />
            <ol className="space-y-4 px-5 pb-5">
              {(updates ?? []).length === 0 && <li className="text-sm text-muted">لا تحديثات بعد.</li>}
              {(updates ?? []).map((u: any) => (
                <li key={u.id} className="flex gap-3">
                  <Avatar name={u.profiles?.full_name ?? '—'} size={30} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p>
                      <span className="font-semibold text-ink">{u.profiles?.full_name ?? 'النظام'}</span>
                      <span className="text-muted"> — {u.to_status && u.from_status !== u.to_status ? STEP_STATUS[u.to_status as 'completed'] : 'ملاحظة'}</span>
                      <span className="ms-2 text-xs text-muted">{fmtDateTime(u.created_at)}</span>
                    </p>
                    {u.actual_output && <p className="mt-1 rounded-xl bg-done-soft px-3 py-1.5 text-text">المخرج المتحقق: {u.actual_output}</p>}
                    {u.note && <p className="mt-1 rounded-xl bg-sunken px-3 py-1.5">{u.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                <CalendarRange size={16} /> فترة التنفيذ
              </p>
              {canManage && <DatesEditor stepId={s.id} start={s.planned_start} end={s.planned_end} source={s.dates_source} />}
            </div>
            {s.planned_end ? (
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-sunken px-3 py-2">
                  <dt className="text-xs text-muted">البداية</dt>
                  <dd className="font-bold text-ink">{fmtDate(s.planned_start)}</dd>
                </div>
                <div className="rounded-xl bg-sunken px-3 py-2">
                  <dt className="text-xs text-muted">النهاية</dt>
                  <dd className="font-bold text-ink">{fmtDate(s.planned_end)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 rounded-xl bg-orange-soft px-3 py-2 text-sm text-late">لا توجد جدولة تحدد تاريخ المهمة — بحاجة لمراجعة.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {s.dates_source === 'manual' ? 'محددة يدويًا' : 'مستخرجة من الجدولة الأسبوعية'}
              {s.weeks.length > 0 && ` · ${s.weeks.length} أسابيع (${[...new Set(b.filter((w) => s.weeks.includes(w.weekIndex)).map((w) => MONTHS[w.month]))].join('، ')})`}
            </p>
            {s.actual_end && <p className="mt-1 text-xs text-done">اكتملت في {fmtDate(s.actual_end)}</p>}
            <div className="mt-4">
              <ProgressBar value={s.progress} planned={e.planned} tone={s.status === 'completed' ? 'done' : e.isLate ? 'late' : 'teal'} />
              <p className="mt-1.5 text-xs text-muted">
                الإنجاز <span className="num font-semibold text-text">{fmtPct(s.progress)}</span> · المخطط حتى اليوم <span className="num">{fmtPct(e.planned)}</span>
              </p>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">المكلفون بالمهمة</p>
              {canManage && (
                <AssigneePicker
                  trigger="link"
                  stepId={s.id}
                  hasSubsteps={s.substeps.length > 0}
                  current={{ userIds: s.assignees.map((a) => a.user_id), leadId: s.assignees.find((a) => a.is_lead)?.user_id ?? null, mode: s.assignment_mode, threshold: s.completion_threshold, allDept: s.assign_scope === 'all_dept' }}
                  people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name, sub: `${ROLE_LABELS[p.role]}${p.job_title ? ` · ${p.job_title}` : ''}${p.department_id && p.department_id !== s.plan.department_id ? ` · ${deptName(depts, p.department_id, true)}` : ''}`, inDept: p.department_id === s.plan.department_id && p.role !== 'executive_director' }))}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {s.assignees.length ? ASSIGN_MODE[s.assignment_mode] : 'غير مسندة'}
              {s.assign_scope === 'all_dept' && ' · جميع موظفي الإدارة'}
              {individual && ` · تكتمل عند ${s.completion_threshold >= 100 ? 'إنجاز الجميع' : `إنجاز ${fmtPct(s.completion_threshold)} منهم`} (${doneCount}/${s.assignees.length})`}
            </p>
            {s.responsible_text && <p className="mt-2 text-xs text-muted">المسؤول في الخطة: {s.responsible_text}</p>}
            <ul className="mt-3 space-y-2">
              {s.assignees.map((a) => (
                <li key={a.user_id} className="flex items-center gap-2.5">
                  <Avatar name={a.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-sm font-semibold">
                      {a.name}
                      {a.is_lead && <Crown size={13} className="text-orange" aria-label="المسؤول الرئيسي" />}
                    </span>
                    {individual && a.completed_at && <span className="block text-xs text-muted">أنجز في {fmtDate(a.completed_at)}</span>}
                  </span>
                  {individual &&
                    (canManage && approved ? <AssigneeStatusSelect stepId={s.id} userId={a.user_id} value={a.status} /> : <Pill tone={stateTone(a.status)}>{STEP_STATUS[a.status]}</Pill>)}
                </li>
              ))}
            </ul>
            {individual && s.assignees.length > 0 && (
              <div className="mt-3">
                <ProgressBar value={(doneCount / s.assignees.length) * 100} tone="done" size="sm" />
              </div>
            )}
          </Panel>
          <Link href={`/activities/${s.activity_id}`} className="card card-hover block p-4 text-sm">
            <span className="text-xs text-muted">{s.activityKind === 'project' ? 'المشروع' : 'النشاط'}</span>
            <span className="block font-bold text-ink">{s.activityTitle}</span>
            <span className="text-xs text-teal">عرض كل مهامه ←</span>
          </Link>
        </aside>
      </div>
    </>
  );
}
