import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getDepartments, getSetting, resolvePeriod } from '@/lib/data/common';
import { evaluateQuarter, loadYearProgress } from '@/lib/data/progress';
import { loadActivities } from '@/lib/data/plans';
import { quarterCurve } from '@/lib/engine/progress';
import { ActivityCard } from '@/components/activity-card';
import { CurveChart } from '@/components/dashboard/curve';
import { EmptyState, Notice, PageHeader, Panel, PanelHead, Pill, ProgressBar, stateTone } from '@/components/ui';
import { PeriodPicker } from '@/components/period-picker';
import { DATA_STATE, PLAN_STATUS, QUARTER_LABEL } from '@/lib/labels';
import { fmtDateTime, fmtPct } from '@/lib/format';
import { deptCounts } from '@/lib/engine/counts';
import { WorkCountsBlocks } from '@/components/dashboard/counts';

export default async function DepartmentDrill({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ year?: string; q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb } = await requireSession();
  const period = await resolvePeriod(sb, sp);
  const depts = await getDepartments(sb, true);
  const dept = depts.find((d) => d.id === id);
  if (!dept) notFound();
  const yp = await loadYearProgress(sb, period.year);
  const org = evaluateQuarter(yp, period.quarter, { asOf: period.today, staleAfterDays: await getSetting(sb, 'stale_after_days', 14) });
  const d = org.departments.find((x) => x.departmentId === id);
  const planFact = yp.plans.find((p) => p.quarter === period.quarter && p.departmentId === id);
  const b = yp.boundaries[period.quarter] ?? [];
  const visibleActs = planFact ? await loadActivities(sb, [planFact.id], { [planFact.id]: b }, period.today) : [];
  const curve = planFact && (planFact.status === 'approved' || planFact.status === 'archived') ? quarterCurve(planFact, b, period.today) : [];

  return (
    <>
      <PageHeader
        back={{ href: `/dashboard?year=${period.year}&q=${period.quarter}`, label: 'لوحة الأداء — الجمعية' }}
        title={dept.name}
        sub={`${QUARTER_LABEL[period.quarter]} ${period.year}م${planFact ? ` — الخطة ${PLAN_STATUS[planFact.status]}` : ''}`}
        actions={<PeriodPicker years={period.years.map((y) => y.year)} year={period.year} quarter={period.quarter} />}
      />
      {!d || d.progress === null ? (
        <EmptyState title={d ? DATA_STATE[d.dataState] : 'لا توجد خطة'} body="لا يُعرض إنجاز لهذه الإدارة حتى تُعتمد خطتها لهذا الربع، ولا يُحتسب صفرًا." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <Panel className="p-5">
              <p className="text-sm text-muted">إنجاز الإدارة</p>
              <p className="num text-5xl font-bold text-ink" style={{ textAlign: 'right' }}>{fmtPct(d.progress)}</p>
              <div className="mt-4">
                <ProgressBar value={d.progress} planned={d.planned} size="lg" />
                <p className="mt-1.5 text-xs text-muted">المخطط حتى اليوم {fmtPct(d.planned)}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone={stateTone(d.dataState)}>{DATA_STATE[d.dataState]}</Pill>
              </div>
              <p className="mt-3 text-xs text-muted">آخر تحديث: {fmtDateTime(d.lastUpdateAt)}</p>
            </Panel>
            <Panel>
              <PanelHead title="المخطط مقابل المتحقق" />
              <div className="px-3 pb-3">
                <CurveChart data={curve} height={220} />
              </div>
            </Panel>
          </div>
          <WorkCountsBlocks
            counts={deptCounts(d, planFact)}
            hrefWorks={(st) => `/activities?year=${period.year}&q=${period.quarter}&dept=${id}&state=${st}`}
            hrefTasks={(st) => `/activities?year=${period.year}&q=${period.quarter}&dept=${id}&tasks=${st}`}
          />
          {visibleActs.length ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-ink">المشاريع والأنشطة</h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {visibleActs.map((a) => (
                  <ActivityCard key={a.id} a={a} dept={dept.short_name ?? dept.name} href={`/activities/${a.id}`} />
                ))}
              </div>
            </section>
          ) : (
            <Notice tone="nodata" title="التفاصيل حسب الصلاحية">
              تفاصيل أنشطة هذه الإدارة متاحة للمدير التنفيذي ومدير الإدارة وأعضاء مجلس الإدارة.
            </Notice>
          )}
        </div>
      )}
    </>
  );
}
