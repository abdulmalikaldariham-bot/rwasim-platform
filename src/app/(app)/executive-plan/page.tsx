import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, resolvePeriod } from '@/lib/data/common';
import { loadExecPlan } from '@/lib/data/kpis';
import { EmptyState, PageHeader, Panel, Pill, stateTone, ButtonLink } from '@/components/ui';
import { PeriodPicker } from '@/components/period-picker';
import { ExecToolbar, AxisEditor, GoalEditor, KpiEditor, ExecImporter, CreateExecPlan } from './editor';
import { KPI_STATUS, PLAN_STATUS, FREQUENCY } from '@/lib/labels';
import { fmtNum, fmtPct } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'الخطة التنفيذية' };

export default async function ExecutivePlan({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const period = await resolvePeriod(sb, sp);
  const ex = await loadExecPlan(sb, period.year, period.quarter);
  const depts = await getDepartments(sb, true);
  const isEd = profile.role === 'executive_director';
  const editable = isEd && ex.plan && ex.plan.status !== 'archived';
  const yearInfo = period.years.find((y) => y.year === period.year);
  const deptOpts = depts.filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.name }));

  return (
    <>
      <PageHeader
        title={`الخطة التنفيذية ${period.year}م`}
        sub="التوجهات الكبرى والأهداف التنفيذية ومؤشرات الأداء ومستهدفاتها للسنة"
        actions={
          <>
            <PeriodPicker years={period.years.map((y) => y.year)} year={period.year} showQuarter={false} />
            {isEd && (
              <ButtonLink variant="secondary" href={`/api/templates/executive?year=${period.year}`}>
                تنزيل القالب
              </ButtonLink>
            )}
          </>
        }
      />
      {!ex.plan ? (
        <div className="space-y-6">
          <EmptyState
            title={`لا توجد خطة تنفيذية لعام ${period.year}م`}
            body={yearInfo?.is_transitional ? 'هذه سنة انتقالية؛ الخطة التنفيذية اختيارية وتعمل المنصة بالخطط التشغيلية وحدها.' : isEd ? 'أنشئها يدويًا أو استوردها من قالب Excel.' : 'لم يضفها المدير التنفيذي بعد.'}
          />
          {isEd && yearInfo?.status !== 'archived' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="p-5">
                <h2 className="mb-3 font-semibold text-ink">إنشاء يدوي</h2>
                <CreateExecPlan year={period.year} />
              </Panel>
              <Panel className="p-5">
                <h2 className="mb-3 font-semibold text-ink">استيراد من Excel</h2>
                <ExecImporter year={period.year} />
              </Panel>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 card px-5 py-3">
            <div className="flex items-center gap-3">
              <Pill tone={stateTone(ex.plan.status)}>{PLAN_STATUS[ex.plan.status as 'draft']}</Pill>
              <span className="text-sm text-muted">{ex.kpis.length} مؤشرًا في {ex.axes.length} محاور</span>
            </div>
            {isEd && <ExecToolbar planId={ex.plan.id} status={ex.plan.status} />}
          </div>
          {editable && ex.plan.status === 'approved' && (
            <p className="text-sm text-muted">الخطة معتمدة: أي تعديل على المستهدفات يُسجل في سجل التغييرات.</p>
          )}
          {ex.axes.map((a) => (
            <Panel key={a.id} className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">{a.title}</h2>
                {editable && a.id !== 'none' && <AxisEditor planId={ex.plan!.id} axis={a} />}
              </div>
              <div className="space-y-5">
                {a.goals.map((g) => (
                  <div key={g.id} className="rounded-lg border border-line">
                    <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken/50 px-4 py-2.5">
                      <h3 className="font-semibold text-teal">{g.title}</h3>
                      {editable && g.id !== 'none' && (
                        <div className="flex gap-2">
                          <GoalEditor planId={ex.plan!.id} axisId={a.id} goal={g} />
                          <KpiEditor planId={ex.plan!.id} goalId={g.id} depts={deptOpts} />
                        </div>
                      )}
                    </div>
                    {g.kpis.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted">لا مؤشرات بعد.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {g.kpis.map((k) => (
                          <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <Link href={`/dashboard/kpi/${k.id}`} className="font-medium text-ink hover:text-teal">
                                {k.code ? <span className="text-muted">{k.code} — </span> : null}
                                {k.name}
                              </Link>
                              <p className="text-xs text-muted">
                                {deptName(depts, k.department_id, true)} — {FREQUENCY[k.frequency]} — المستهدف {fmtNum(k.annual_target)} {k.unit ?? ''}
                                {k.direction === 'decrease' ? ' (الانخفاض تحسن)' : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="num text-sm">{fmtPct(k.evaluation.achievement)}</span>
                              <Pill tone={stateTone(k.evaluation.status)}>{KPI_STATUS[k.evaluation.status]}</Pill>
                              {editable && <KpiEditor planId={ex.plan!.id} goalId={g.id} depts={deptOpts} kpi={k} />}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {editable && a.id !== 'none' && <GoalEditor planId={ex.plan!.id} axisId={a.id} />}
              </div>
            </Panel>
          ))}
          {editable && (
            <div className="flex flex-wrap gap-3">
              <AxisEditor planId={ex.plan.id} />
            </div>
          )}
          {editable && (
            <Panel className="p-5">
              <h2 className="mb-1 font-semibold text-ink">إضافة مؤشرات من Excel</h2>
              <p className="mb-3 text-sm text-muted">تضاف المحاور والأهداف والمؤشرات الواردة في الملف إلى هذه الخطة.</p>
              <ExecImporter year={period.year} />
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
