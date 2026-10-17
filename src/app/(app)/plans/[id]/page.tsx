import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { loadPlan } from '@/lib/data/plans';
import { ButtonLink, Notice, PageHeader, Panel, PanelHead, Pill, stateTone } from '@/components/ui';
import { PlanActions, StructureEditor, ChangeRequestActions } from './plan-client';
import { PLAN_STATUS, QUARTER_LABEL, MONTHS } from '@/lib/labels';
import { KIND_LABELS } from '@/lib/engine/weights';
import { fmtDateTime, fmtPct } from '@/lib/format';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, profile } = await requireSession();
  const data = await loadPlan(sb, id);
  if (!data) notFound();
  const { plan, activities, boundaries } = data;
  const depts = await getDepartments(sb, true);
  const isEd = profile.role === 'executive_director';
  const isMgr = profile.role === 'dept_manager' && profile.department_id === plan.department_id;
  const editable = (isEd || isMgr) && (plan.status === 'draft' || plan.status === 'returned');
  const [{ data: issues }, { data: requests }, { data: snaps }, { data: kpis }] = await Promise.all([
    sb.rpc('plan_weight_issues', { p_plan: id }),
    sb.from('change_requests').select('id,kind,reason,status,requested_at,decided_at,decision_note,payload,profiles!change_requests_requested_by_fkey(full_name)').eq('plan_id', id).order('requested_at', { ascending: false }),
    sb.from('plan_weight_snapshots').select('version,approved_at,reason').eq('plan_id', id).order('version', { ascending: false }),
    sb.from('kpis').select('id,name,exec_plans!inner(year)').eq('exec_plans.year', plan.year),
  ]);
  const issueList = (issues ?? []) as { level: string; ref_id: string; message: string }[];
  const months = [...new Set(boundaries.map((b) => b.month))];

  return (
    <>
      <PageHeader
        back={{ href: `/plans?year=${plan.year}`, label: 'الخطط التشغيلية' }}
        title={`خطة ${deptName(depts, plan.department_id)}`}
        sub={`${QUARTER_LABEL[plan.quarter]} ${plan.year}م (${months.map((m) => MONTHS[m]).join('، ')})`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={stateTone(plan.status)}>{PLAN_STATUS[plan.status]}</Pill>
            {plan.version > 1 && <Pill>الإصدار {plan.version}</Pill>}
          </div>
        }
      />
      {plan.status === 'returned' && plan.return_note && (
        <div className="mb-4">
          <Notice tone="late" title="أعاد المدير التنفيذي الخطة للتعديل">
            {plan.return_note}
          </Notice>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-3">
        <p className="text-sm text-muted">
          {activities.length} أنشطة، {activities.reduce((s, a) => s + a.steps.length, 0)} مهمة —{' '}
          {issueList.length === 0 ? <span className="text-done">الأوزان مكتملة</span> : <span className="text-late">{issueList.length} ملاحظات على الأوزان</span>}
        </p>
        <PlanActions
          planId={plan.id}
          status={plan.status}
          isEd={isEd}
          canEdit={isEd || isMgr}
          hasIssues={issueList.length > 0}
          hasPendingRequest={(requests ?? []).some((r) => r.status === 'pending')}
        />
      </div>

      {issueList.length > 0 && plan.status !== 'approved' && plan.status !== 'archived' && (
        <div className="mb-6">
          <Notice tone="late" title="قبل الرفع للاعتماد">
            <ul className="list-disc ps-5">
              {issueList.slice(0, 8).map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
            <Link href={`/plans/${plan.id}/weights`} className="mt-1 inline-block font-medium underline">
              افتح شاشة الأوزان لمعالجتها
            </Link>
          </Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div>
          {editable ? (
            <StructureEditor
              planId={plan.id}
              activities={activities.map((a) => ({
                id: a.id,
                title: a.title,
                kind: a.kind,
                kpi_id: a.kpi_id,
                weight: a.weight,
                steps: a.steps.map((s) => ({ id: s.id, title: s.title, responsible_text: s.responsible_text, output: s.output, weeks: s.weeks, weight: s.weight, is_core: s.is_core, import_followup: s.import_followup })),
              }))}
              months={months}
              kpis={(kpis ?? []).map((k) => ({ id: k.id, name: k.name }))}
            />
          ) : (
            <div className="space-y-4">
              {activities.map((a) => (
                <Panel key={a.id}>
                  <PanelHead
                    title={
                      <Link href={`/activities/${a.id}`} className="hover:text-teal">
                        {a.title}
                      </Link>
                    }
                    hint={`${KIND_LABELS[a.kind]} — الوزن ${fmtPct(a.weight)}${a.kpi_id ? ` — مرتبط بمؤشر: ${(kpis ?? []).find((k) => k.id === a.kpi_id)?.name ?? ''}` : ''}`}
                    action={<span className="num text-sm font-semibold">{fmtPct(a.eval.progress)}</span>}
                  />
                  <ul className="divide-y divide-line border-t border-line text-sm">
                    {a.steps.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                        <span>
                          {s.title}
                          {s.is_core && <span className="ms-2 text-xs text-late">الجوهرية</span>}
                          <span className="block text-xs text-muted">
                            {s.responsible_text ?? '—'} — {s.output ?? '—'}
                          </span>
                        </span>
                        <span className="num text-xs text-muted">{fmtPct(s.weight)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}
        </div>
        <aside className="space-y-4">
          {(isEd || isMgr) && plan.status !== 'archived' && (
            <Panel className="p-4">
              <p className="mb-2 font-semibold text-ink">إعادة استيراد نسخة محدثة</p>
              <p className="mb-3 text-sm text-muted">قارن ملفًا جديدًا بالخطة الحالية قبل تطبيق أي تغيير. الإنجاز السابق لا يُحذف.</p>
              <ButtonLink variant="secondary" href={`/plans/${plan.id}/reimport`} className="w-full">
                مقارنة ملف جديد
              </ButtonLink>
            </Panel>
          )}
          <Panel>
            <PanelHead title="طلبات التعديل" />
            <ul className="space-y-3 px-5 pb-5 text-sm">
              {(requests ?? []).length === 0 && <li className="text-muted">لا توجد طلبات.</li>}
              { }
              {(requests ?? []).map((r: any) => (
                <li key={r.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{{ weights: 'تعديل أوزان', structure: 'تعديل هيكلي', schedule: 'تعديل جدولة' }[r.kind as 'weights']}</span>
                    <Pill tone={r.status === 'pending' ? 'late' : r.status === 'approved' ? 'done' : 'stalled'}>{{ pending: 'بانتظار القرار', approved: 'معتمد', rejected: 'مرفوض' }[r.status as 'pending']}</Pill>
                  </div>
                  <p className="mt-1 text-muted">{r.reason}</p>
                  <p className="text-xs text-muted">
                    {r.profiles?.full_name} — {fmtDateTime(r.requested_at)}
                  </p>
                  {r.decision_note && <p className="mt-1 text-xs">القرار: {r.decision_note}</p>}
                  {isEd && r.status === 'pending' && <ChangeRequestActions id={r.id} />}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHead title="إصدارات الأوزان المعتمدة" />
            <ul className="space-y-1 px-5 pb-5 text-sm">
              {(snaps ?? []).length === 0 && <li className="text-muted">تحفظ عند الاعتماد.</li>}
              {(snaps ?? []).map((s) => (
                <li key={s.version} className="flex justify-between gap-2">
                  <span>الإصدار {s.version}</span>
                  <span className="text-xs text-muted">{fmtDateTime(s.approved_at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
