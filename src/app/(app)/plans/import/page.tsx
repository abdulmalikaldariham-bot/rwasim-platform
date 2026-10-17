import { requireSession } from '@/lib/auth';
import { getDepartments, resolvePeriod } from '@/lib/data/common';
import { PageHeader } from '@/components/ui';
import { ImportWizard } from './wizard';

export const metadata = { title: 'استيراد خطة' };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession(['executive_director', 'dept_manager']);
  const period = await resolvePeriod(sb, sp);
  const depts = await getDepartments(sb);
  const { data: plans } = await sb.from('op_plans').select('id,year,quarter,department_id,status');
  return (
    <>
      <PageHeader back={{ href: '/plans', label: 'الخطط التشغيلية' }} title="استيراد خطة تشغيلية من Excel" sub="الملف مصدر للبيانات فقط: ستراجع الأنشطة والخطوات والجدولة قبل حفظها كمسودة." />
      <ImportWizard
        years={period.years.filter((y) => y.status !== 'archived').map((y) => y.year)}
        initialYear={period.year}
        initialQuarter={period.quarter}
        depts={depts.map((d) => ({ id: d.id, name: d.name }))}
        ownDept={profile.role === 'dept_manager' ? profile.department_id : null}
        existing={(plans ?? []).map((p) => ({ id: p.id, year: p.year, quarter: p.quarter, departmentId: p.department_id, status: p.status }))}
      />
    </>
  );
}
