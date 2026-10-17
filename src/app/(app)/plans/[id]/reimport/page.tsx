import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments } from '@/lib/data/common';
import { PageHeader } from '@/components/ui';
import { ReimportClient } from './reimport-client';
import { PLAN_STATUS, QUARTER_LABEL } from '@/lib/labels';

export default async function Reimport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb } = await requireSession(['executive_director', 'dept_manager']);
  const { data: plan } = await sb.from('op_plans').select('id,year,quarter,department_id,status').eq('id', id).maybeSingle();
  if (!plan) notFound();
  const depts = await getDepartments(sb, true);
  return (
    <>
      <PageHeader
        back={{ href: `/plans/${id}`, label: 'صفحة الخطة' }}
        title="إعادة استيراد نسخة محدثة"
        sub={`${deptName(depts, plan.department_id)} — ${QUARTER_LABEL[plan.quarter]} ${plan.year}م — الخطة ${PLAN_STATUS[plan.status as 'draft']}`}
      />
      <ReimportClient planId={id} approved={plan.status === 'approved'} />
    </>
  );
}
