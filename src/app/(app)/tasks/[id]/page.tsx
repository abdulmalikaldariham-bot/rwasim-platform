import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, Target, Users } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { getBoundaries, loadStepsOnly, stepFact } from '@/lib/data/plans';
import { evaluateStep } from '@/lib/engine/progress';
import { PageHeader, Panel, PanelHead, Pill, stateTone, Notice } from '@/components/ui';
import { OutputsPanel, ProgressPanel, DatesPanel, AssigneesPanel } from './task-client';
import { DATES_SOURCE, OUTPUT_POLICY, PLAN_STATUS, STEP_STATUS, TIME_STATE } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format';

export const metadata = { title: 'المهمة' };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; act?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const [s] = await loadStepsOnly(sb, { ids: [id] });
  if (!s) notFound();
  const plan = s.plan;
  const [boundaries, { data: dept }, { data: evidence }, { data: updates }] = await Promise.all([
    getBoundaries(sb, plan.year, plan.quarter),
    sb.from('departments').select('id,name').eq('id', plan.department_id).single(),
    sb.from('evidence').select('id,kind,url,file_name,storage_path,note,created_at,uploaded_by,profiles(full_name)').eq('step_id', id).order('created_at', { ascending: false }),
    sb.from('step_updates').select('id,created_at,note,from_status,to_status,to_progress,profiles(full_name)').eq('step_id', id).order('created_at', { ascending: false }).limit(40),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const e = evaluateStep(stepFact(s), boundaries, today);
  const isEd = profile.role === 'executive_director';
  const isMgr = profile.role === 'dept_manager' && profile.department_id === plan.department_id;
  const isAssignee = s.assignees.some((a) => a.user_id === profile.id);
  const canManage = (isEd || isMgr) && plan.status !== 'archived';
  const canUpdate = plan.status === 'approved' && (isEd || isMgr || isAssignee);
  let people: { id: string; name: string; role: string; dept: string | null }[] = [];
  if (canManage) {
    let q = sb.from('profiles').select('id,full_name,role,department_id').eq('is_active', true).in('role', ['employee', 'dept_manager', 'executive_director']).order('full_name');
    if (!isEd) q = q.eq('department_id', plan.department_id);
    const { data } = await q;
    people = (data ?? []).map((p) => ({ id: p.id, name: p.full_name, role: p.role, dept: p.department_id }));
  }
  const tone = s.status === 'completed' ? 'done' : e.isLate ? 'late' : stateTone(s.status);
  const back = sp.from && sp.from.startsWith('/') ? { href: sp.from, label: 'رجوع' } : { href: `/activities/${s.activity_id}`, label: s.activityTitle };

  return (
    <>
      <PageHeader
        back={back}
        title={s.title}
        sub={
          <>
            <Link href={`/activities/${s.activity_id}`} className="text-teal hover:underline">
              {s.activityKind === 'project' ? 'مشروع' : 'نشاط'}: {s.activityTitle}
            </Link>{' '}
            — {dept?.name}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone}>{e.isLate && s.status !== 'completed' ? `متأخرة ${e.daysLate} يومًا` : STEP_STATUS[s.status]}</Pill>
            <Pill tone="neutral">{TIME_STATE[e.timeState]}</Pill>
            {s.is_core && <Pill tone="orange">المهمة الجوهرية</Pill>}
          </div>
        }
      />
      {plan.status !== 'approved' && (
        <div className="mb-5">
          <Notice tone="nodata">الخطة {PLAN_STATUS[plan.status]}؛ تسجيل الإنجاز متاح بعد اعتمادها.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* المخرجات أولًا: ما المطلوب وما الذي تحقق */}
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-sunken/60 px-5 py-3">
              <Target size={18} className="text-orange" />
              <h2 className="font-semibold text-ink">المخرجات</h2>
              <span className="ms-auto text-xs text-muted">{OUTPUT_POLICY[s.output_policy]}</span>
            </div>
            <div className="grid gap-0 md:grid-cols-2">
              <div className="border-b border-line p-5 md:border-b-0 md:border-l">
                <p className="text-sm text-muted">المخرج المطلوب</p>
                <p className="mt-1 text-lg font-semibold leading-relaxed text-ink">{s.output ?? <span className="text-late">لم يُحدد في الخطة</span>}</p>
              </div>
              <div className="p-5">
                <OutputsPanel
                  stepId={s.id}
                  achieved={s.output_achieved}
                  canEdit={canUpdate}
                  policy={s.output_policy}
                  canSetPolicy={canManage}
                  evidence={(evidence ?? []).map((x) => ({
                    id: x.id,
                    kind: x.kind as 'file' | 'link',
                    url: x.url,
                    name: x.file_name,
                    path: x.storage_path,
                    note: x.note,
                     
                    by: (x as any).profiles?.full_name ?? '',
                    at: fmtDate(x.created_at),
                    mine: x.uploaded_by === profile.id,
                  }))}
                  canDeleteAll={isEd}
                />
              </div>
            </div>
          </Panel>

          <Panel id="update">
            <PanelHead
              title="تسجيل الإنجاز"
              hint={s.assignment_mode === 'individual' ? `مهمة فردية: يسجل كل مكلف إنجازه، وتكتمل عند إنجاز ${fmtPct(s.completion_threshold)} من المكلفين` : 'مهمة مشتركة: سجل إنجاز واحد للمهمة مع تتبع من حدّثها'}
              action={<span className="num text-2xl font-bold text-ink">{fmtPct(s.progress)}</span>}
            />
            <div className="px-5 pb-5">
              <ProgressPanel
                stepId={s.id}
                status={s.status}
                mode={s.assignment_mode}
                substeps={s.substeps}
                assignees={s.assignees}
                me={profile.id}
                canUpdate={canUpdate}
                canManage={isEd || isMgr}
                policy={s.output_policy}
                achieved={s.output_achieved}
                autoFocus={sp.act === '1'}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHead title="سجل التحديثات" />
            <ul className="space-y-3 px-5 pb-5">
              {(updates ?? []).length === 0 && <li className="text-sm text-muted">لا تحديثات بعد.</li>}
              { }
              {(updates ?? []).map((u: any) => (
                <li key={u.id} className="border-s-2 border-line ps-3 text-sm">
                  <p className="text-ink">
                    <span className="font-medium">{u.profiles?.full_name ?? '—'}</span>
                    <span className="text-muted">
                      {' '}
                      — {u.from_status === u.to_status ? 'ملاحظة' : `${STEP_STATUS[u.to_status as 'completed']} (${fmtPct(Number(u.to_progress))})`}
                    </span>
                  </p>
                  {u.note && <p className="mt-1 rounded-lg bg-sunken px-2 py-1">{u.note}</p>}
                  <p className="text-xs text-muted">{fmtDateTime(u.created_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
              <CalendarDays size={17} className="text-teal" /> الفترة الزمنية
            </h2>
            <DatesPanel
              stepId={s.id}
              start={s.start_date}
              end={s.end_date}
              source={s.dates_source}
              sourceLabel={DATES_SOURCE[s.dates_source]}
              canEdit={canManage}
              quarterStart={boundaries[0]?.start}
              quarterEnd={boundaries.at(-1)?.end}
            />
          </Panel>
          <Panel className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
              <Users size={17} className="text-teal" /> المكلفون بالمهمة
            </h2>
            {s.responsible_text && <p className="mb-3 text-xs text-muted">المسؤول في الخطة: {s.responsible_text}</p>}
            <AssigneesPanel
              stepId={s.id}
              assignees={s.assignees}
              mode={s.assignment_mode}
              threshold={s.completion_threshold}
              scope={s.assign_scope}
              external={s.external_assignees}
              isEd={isEd}
              people={people}
              canManage={canManage}
              started={s.progress > 0 || s.status !== 'not_started'}
            />
          </Panel>
          <Panel className="p-5 text-sm">
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-muted">الوزن داخل النشاط</dt>
              <dd className="num text-left">{fmtPct(s.weight)}</dd>
              <dt className="text-muted">تاريخ البدء الفعلي</dt>
              <dd className="text-left">{fmtDate(s.actual_start)}</dd>
              <dt className="text-muted">تاريخ الإكمال</dt>
              <dd className="text-left">{fmtDate(s.actual_end)}</dd>
            </dl>
          </Panel>
        </aside>
      </div>
    </>
  );
}
