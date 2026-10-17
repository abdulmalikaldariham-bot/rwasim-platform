import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, resolvePeriod } from '@/lib/data/common';
import { EmptyState, PageHeader, Panel, PanelHead, Pill } from '@/components/ui';
import { GenerateReport } from './generate';
import { REPORT_TYPE } from '@/lib/labels';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'التقارير' };

export default async function Reports() {
  const { sb, profile } = await requireSession(['executive_director', 'dept_manager', 'board_member']);
  const period = await resolvePeriod(sb, {});
  const depts = await getDepartments(sb, true);
  const { data: reports } = await sb.from('reports').select('id,type,year,quarter,month,department_id,title,status,generated_at,approved_at').order('generated_at', { ascending: false }).limit(200);
  const canGenerate = profile.role === 'executive_director' || profile.role === 'dept_manager';
  return (
    <>
      <PageHeader title={profile.role === 'board_member' ? 'التقارير المعتمدة' : 'مركز التقارير'} sub="تُصدر عند الطلب، ويُحفظ لكل تقرير نسخة ثابتة لا تتغير بتعديل البيانات لاحقًا." />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        {canGenerate && (
          <Panel className="h-fit">
            <PanelHead title="إصدار تقرير" />
            <div className="px-5 pb-5">
              <GenerateReport
                years={period.years.map((y) => y.year)}
                year={period.year}
                quarter={period.quarter}
                depts={(profile.role === 'dept_manager' ? depts.filter((d) => d.id === profile.department_id) : depts).map((d) => ({ id: d.id, name: d.name }))}
                allowOrg={profile.role === 'executive_director'}
              />
            </div>
          </Panel>
        )}
        <Panel className={canGenerate ? '' : 'xl:col-span-2'}>
          <PanelHead title="التقارير المحفوظة" />
          {(reports ?? []).length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="لا توجد تقارير بعد" body={canGenerate ? 'اختر النوع والفترة ثم أصدر التقرير.' : 'تظهر هنا التقارير بعد اعتمادها من المدير التنفيذي.'} />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {(reports ?? []).map((r) => (
                <li key={r.id}>
                  <Link href={`/reports/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-sunken">
                    <span>
                      <span className="font-medium text-ink">{r.title}</span>
                      <span className="block text-xs text-muted">
                        {REPORT_TYPE[r.type]} — {r.department_id ? deptName(depts, r.department_id) : 'الجمعية كاملة'} — أصدر {fmtDateTime(r.generated_at)}
                      </span>
                    </span>
                    <Pill tone={r.status === 'approved' ? 'done' : 'late'}>{r.status === 'approved' ? 'معتمد' : 'مسودة'}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
