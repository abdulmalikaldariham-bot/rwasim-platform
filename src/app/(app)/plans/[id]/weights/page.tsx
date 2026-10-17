import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { loadPlan } from '@/lib/data/plans';
import { PageHeader } from '@/components/ui';
import { WeightsEditor } from './weights-editor';
import { PLAN_STATUS, QUARTER_LABEL } from '@/lib/labels';

export const metadata = { title: 'إدارة الأوزان' };

export default async function WeightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, profile } = await requireSession(['executive_director', 'dept_manager']);
  const data = await loadPlan(sb, id);
  if (!data) notFound();
  const { plan, activities } = data;
  const isEd = profile.role === 'executive_director';
  if (!isEd && profile.department_id !== plan.department_id) redirect(`/plans/${id}`);
  if (plan.status === 'archived' || plan.status === 'submitted') redirect(`/plans/${id}`);
  const depts = await getDepartments(sb, true);
  return (
    <>
      <PageHeader
        back={{ href: `/plans/${id}`, label: 'صفحة الخطة' }}
        title="إدارة الأوزان"
        sub={`${deptName(depts, plan.department_id)} — ${QUARTER_LABEL[plan.quarter]} ${plan.year}م — ${PLAN_STATUS[plan.status]}`}
      />
      <WeightsEditor
        planId={plan.id}
        quarter={plan.quarter}
        mode={plan.status === 'approved' ? (isEd ? 'direct' : 'request') : 'draft'}
        isEd={isEd}
        activities={activities.map((a) => ({
          id: a.id,
          title: a.title,
          kind: a.kind,
          weight: a.weight,
          suggested: a.suggested_weight === null ? null : Number(a.suggested_weight),
          steps: a.steps.map((s) => ({
            id: s.id,
            title: s.title,
            weight: s.weight,
            suggested: s.suggested_weight === null ? null : Number(s.suggested_weight),
            is_core: s.is_core,
            responsible: s.responsible_text,
            output: s.output,
            weeks: s.weeks,
            substeps: s.substeps.map((x) => ({ title: x.title, weight: x.weight })),
          })),
        }))}
      />
    </>
  );
}
