import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getDepartments, resolvePeriod } from '@/lib/data/common';
import { ButtonLink, PageHeader, Panel, Pill, stateTone } from '@/components/ui';
import { PeriodPicker } from '@/components/period-picker';
import { NewPlanButton } from './new-plan';
import { PLAN_STATUS, QUARTER_LABEL } from '@/lib/labels';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'الخطط التشغيلية' };

export default async function Plans({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession(['executive_director', 'dept_manager']);
  const period = await resolvePeriod(sb, sp);
  const depts = (await getDepartments(sb, true)).filter((d) => d.is_active || profile.role === 'executive_director');
  const visibleDepts = profile.role === 'dept_manager' ? depts.filter((d) => d.id === profile.department_id) : depts;
  const { data: plans } = await sb.from('op_plans').select('id,department_id,quarter,status,version,updated_at,approved_at').eq('year', period.year);
  const yearInfo = period.years.find((y) => y.year === period.year);
  const archived = yearInfo?.status === 'archived';
  return (
    <>
      <PageHeader
        title={profile.role === 'dept_manager' ? 'خطط الإدارة' : 'الخطط التشغيلية'}
        sub={`أرباع ${period.year}م${archived ? ' — سنة مؤرشفة للاطلاع فقط' : ''}`}
        actions={
          <>
            <PeriodPicker years={period.years.map((y) => y.year)} year={period.year} showQuarter={false} />
            {!archived && (
              <>
                <ButtonLink variant="secondary" href={`/api/templates/operational?year=${period.year}&q=${period.quarter}`}>
                  تنزيل قالب Excel
                </ButtonLink>
                <NewPlanButton year={period.year} quarter={period.quarter} depts={visibleDepts.filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.name }))} />
                <ButtonLink href={`/plans/import?year=${period.year}&q=${period.quarter}`}>استيراد من Excel</ButtonLink>
              </>
            )}
          </>
        }
      />
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-5 py-3 text-right font-medium">الإدارة</th>
              {[1, 2, 3, 4].map((q) => (
                <th key={q} className={`px-3 py-3 text-right font-medium ${q === period.quarter ? 'text-ink' : ''}`}>
                  {QUARTER_LABEL[q]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleDepts.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-medium text-ink">
                  {d.name}
                  {!d.is_active && <span className="ms-2 text-xs text-muted">(غير نشطة)</span>}
                </td>
                {[1, 2, 3, 4].map((q) => {
                  const p = (plans ?? []).find((x) => x.department_id === d.id && x.quarter === q);
                  return (
                    <td key={q} className="px-3 py-3">
                      {p ? (
                        <Link href={`/plans/${p.id}`} className="inline-flex flex-col gap-1 rounded-lg p-1 hover:bg-sunken">
                          <Pill tone={stateTone(p.status)}>{PLAN_STATUS[p.status as 'draft']}</Pill>
                          <span className="text-xs text-muted">
                            {p.version > 1 ? `إصدار ${p.version} — ` : ''}
                            {fmtDate(p.approved_at ?? p.updated_at)}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="mt-4 text-sm text-muted">
        الخطة تمر بالمراحل: مسودة ← ضبط الأوزان ← رفع للاعتماد ← اعتماد المدير التنفيذي ← المتابعة. التحديثات التشغيلية بعد الاعتماد لا تحتاج اعتمادًا، أما تعديل الأوزان والهيكل فيمر بطلب تعديل.
      </p>
    </>
  );
}
