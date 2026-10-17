import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, getSetting, orgCurve, resolvePeriod } from '@/lib/data/common';
import { evaluateQuarter, loadYearProgress } from '@/lib/data/progress';
import { loadExecPlan } from '@/lib/data/kpis';
import { PeriodPicker } from '@/components/period-picker';
import { Strata } from '@/components/dashboard/strata';
import { CurveChart } from '@/components/dashboard/curve';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { EmptyState, PageHeader, Panel, PanelHead, Notice } from '@/components/ui';
import { fmtPct, fmtNum } from '@/lib/format';
import { MONTHS, QUARTER_LABEL } from '@/lib/labels';
import { evaluateStep } from '@/lib/engine/progress';
import { deptCounts, orgCounts } from '@/lib/engine/counts';
import { WorkCountsBlocks } from '@/components/dashboard/counts';

export const metadata = { title: 'لوحة الأداء' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ year?: string; q?: string; axis?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireSession();
  const period = await resolvePeriod(sb, sp);
  const axis = sp.axis === 'exec' ? 'exec' : 'ops';
  const [depts, yp, staleDays] = await Promise.all([getDepartments(sb, true), loadYearProgress(sb, period.year), getSetting<number>(sb, 'stale_after_days', 14)]);
  const names = Object.fromEntries(depts.map((d) => [d.id, d.name]));
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ year: String(period.year), q: String(period.quarter), axis, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="لوحة الأداء المؤسسي"
        sub={`${QUARTER_LABEL[period.quarter]} ${period.year}م`}
        actions={<PeriodPicker years={period.years.map((y) => y.year)} year={period.year} quarter={period.quarter} />}
      />
      <nav className="mb-6 flex gap-1 border-b border-line" aria-label="محاور اللوحة">
        {[
          ['ops', 'الأداء التشغيلي', 'إنجاز الأعمال المخططة'],
          ['exec', 'الأداء التنفيذي السنوي', 'تحقيق النتائج المستهدفة'],
        ].map(([k, l, h]) => (
          <Link
            key={k}
            href={`/dashboard${qs({ axis: k })}`}
            aria-current={axis === k ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 pb-3 ${axis === k ? 'border-orange text-ink' : 'border-transparent text-muted hover:text-text'}`}
          >
            <span className="block font-semibold">{l}</span>
            <span className="block text-xs">{h}</span>
          </Link>
        ))}
      </nav>
      {axis === 'ops' ? <Operational /> : <Executive />}
    </>
  );

  async function Operational() {
    const org = evaluateQuarter(yp, period.quarter, { asOf: period.today, staleAfterDays: staleDays });
    const curve = orgCurve(yp, period.quarter, org, period.today);
    const quarters = [1, 2, 3, 4].map((q) => ({ q, e: evaluateQuarter(yp, q, { asOf: period.today, staleAfterDays: staleDays }) }));
    const b = yp.boundaries[period.quarter] ?? [];
    const plans = yp.plans.filter((p) => p.quarter === period.quarter && (p.status === 'approved' || p.status === 'archived'));
    const wc = orgCounts(org, plans);
    const deptWc = Object.fromEntries(org.departments.map((d) => [d.departmentId, deptCounts(d, plans.find((p) => p.id === d.planId))]));
    const months = [...new Set(b.map((w) => w.month))].map((m) => {
      const weeks = b.filter((w) => w.month === m).map((w) => w.weekIndex);
      const steps = plans.flatMap((p) => p.activities.flatMap((a) => a.steps)).filter((s) => s.weeks.some((w) => weeks.includes(w)));
      const lastDay = b.filter((w) => w.month === m).at(-1)?.end ?? period.today;
      const asOf = lastDay < period.today ? lastDay : period.today;
      const evals = steps.map((s) => ({ s, e: evaluateStep(s, b, asOf) }));
      return {
        m,
        scheduled: steps.length,
        done: steps.filter((s) => s.status === 'completed').length,
        late: evals.filter((x) => x.e.isLate).length,
        future: b.find((w) => w.month === m)!.start > period.today,
      };
    });

    if (!yp.plans.some((p) => p.quarter === period.quarter)) {
      return (
        <EmptyState
          title={`لا توجد خطط تشغيلية في ${QUARTER_LABEL[period.quarter]} ${period.year}م`}
          body="تظهر اللوحة بعد استيراد خطط الإدارات أو إنشائها واعتمادها."
          action={<Link className="text-teal underline" href="/plans">الانتقال إلى الخطط التشغيلية</Link>}
        />
      );
    }

    return (
      <div className="space-y-6">
        <Panel className="overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[18rem_1fr]">
            <div className="flex flex-col justify-between gap-6 border-b border-line bg-sunken/60 p-6 lg:border-b-0 lg:border-l">
              <div>
                <p className="text-sm text-muted">إنجاز الخطة التشغيلية</p>
                {org.computable ? (
                  <p className="num mt-1 text-6xl font-bold tracking-tight text-ink" style={{ textAlign: 'right' }}>
                    {fmtNum(org.progress)}
                    <span className="text-3xl text-muted">٪</span>
                  </p>
                ) : (
                  <div className="mt-2">
                    <p className="text-xl font-bold text-ink">غير قابل للاحتساب بعد</p>
                    <p className="mt-1 text-sm text-muted">
                      {org.missingDepartments.length === 1 ? 'إدارة واحدة' : `${org.missingDepartments.length} إدارات`} بلا خطة معتمدة:{' '}
                      {org.missingDepartments.map((id) => deptName(depts, id, true)).join('، ')}
                    </p>
                    {org.partialProgress !== null && (
                      <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm">
                        مؤشر جزئي للإدارات المعتمدة: <span className="num font-bold">{fmtPct(org.partialProgress)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted">المخطط حتى اليوم</dt>
                  <dd className="num text-lg font-semibold" style={{ textAlign: 'right' }}>{fmtPct(org.planned)}</dd>
                </div>
                <div>
                  <dt className="text-muted">الفارق</dt>
                  <dd className="num text-lg font-semibold" style={{ textAlign: 'right', color: (org.progress ?? org.partialProgress ?? 0) >= (org.planned ?? 0) - 5 ? 'var(--done)' : 'var(--late)' }}>
                    {org.planned === null ? '—' : fmtPct(Math.round(((org.progress ?? org.partialProgress ?? 0) - org.planned) * 10) / 10)}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-ink">إنجاز الإدارات</h2>
                <p className="flex items-center gap-2 text-xs text-muted">
                  <span className="inline-block h-3 w-[3px] rounded bg-ink" /> المخطط حتى اليوم
                </p>
              </div>
              <Strata org={org} names={names} counts={deptWc} hrefFor={(d) => `/dashboard/department/${d.departmentId}${qs({})}`} />
            </div>
          </div>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Panel>
            <PanelHead title="المخطط مقابل المتحقق" hint="تراكمي خلال أسابيع الربع" />
            <div className="px-3 pb-4">
              <CurveChart data={curve} />
            </div>
          </Panel>
          <Panel>
            <PanelHead title="المشاريع والأنشطة والمهام" hint="عدادان منفصلان لا يُجمعان في رقم واحد" />
            <div className="px-5 pb-5">
              <WorkCountsBlocks
                counts={wc}
                compact
                hrefWorks={(st) => `/activities?year=${period.year}&q=${period.quarter}&state=${st}`}
                hrefTasks={(st) => `/activities?year=${period.year}&q=${period.quarter}&tasks=${st}`}
              />
              <h3 className="mt-6 mb-2 text-sm font-semibold text-ink">الإنجاز حسب الأشهر</h3>
              <ul className="divide-y divide-line text-sm">
                {months.map((m) => (
                  <li key={m.m} className="flex items-center justify-between py-2">
                    <span>{MONTHS[m.m]}</span>
                    {m.future ? (
                      <span className="text-muted">{m.scheduled} مهمة مجدولة</span>
                    ) : (
                      <span className="flex gap-3">
                        <span className="text-muted">
                          <span className="num font-semibold text-done">{m.done}</span> من {m.scheduled} مهمة منجزة
                        </span>
                        {m.late > 0 && (
                          <span className="text-late">
                            <span className="num font-semibold">{m.late}</span> متأخرة
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>

        <Panel>
          <PanelHead title={`أرباع ${period.year}م`} hint="الإنجاز التشغيلي لكل ربع (الأرباع المنتهية تقيم كما في نهايتها)" />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4">
            {quarters.map(({ q, e }) => {
              const any = yp.plans.some((p) => p.quarter === q);
              const val = e.computable ? e.progress : e.partialProgress;
              return (
                <Link
                  key={q}
                  href={`/dashboard${qs({ q })}`}
                  className={`rounded-lg border p-4 transition hover:border-teal ${q === period.quarter ? 'border-teal bg-teal-soft/50' : 'border-line'}`}
                >
                  <p className="text-sm text-muted">{QUARTER_LABEL[q]}</p>
                  <p className="num mt-1 text-2xl font-bold text-ink" style={{ textAlign: 'right' }}>
                    {any ? (val === null ? '—' : fmtPct(val)) : '—'}
                  </p>
                  <p className="text-xs text-muted">{!any ? 'لا توجد خطط' : e.computable ? 'كل الإدارات معتمدة' : 'مؤشر جزئي'}</p>
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>
    );
  }

  async function Executive() {
    const ex = await loadExecPlan(sb, period.year, period.quarter);
    const isTransitional = period.years.find((y) => y.year === period.year)?.is_transitional;
    if (!ex.plan) {
      return (
        <EmptyState
          title={`لا توجد خطة تنفيذية معتمدة لعام ${period.year}م`}
          body={isTransitional ? 'هذه سنة انتقالية: المنصة تعمل بالخطط التشغيلية الربعية دون اشتراط خطة تنفيذية سنوية.' : 'يضيفها المدير التنفيذي من صفحة «الخطة التنفيذية».'}
        />
      );
    }
    const k = ex.kpis;
    const by = (s: string) => k.filter((x) => x.evaluation.status === s).length;
    return (
      <div className="space-y-6">
        <Notice tone="teal">
          الأداء التنفيذي يقيس تحقيق النتائج المستهدفة، وهو مستقل عن نسبة إنجاز الأعمال في المحور التشغيلي ولا يدمج معها.
        </Notice>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['مؤشرات', k.length, 'var(--ink)'],
            ['متحققة', by('achieved'), 'var(--done)'],
            ['في المسار', by('on_track'), 'var(--teal)'],
            ['تحتاج انتباهًا', by('at_risk') + by('off_track'), 'var(--orange)'],
            ['بلا قياسات', by('no_data'), 'var(--nodata)'],
          ].map(([l, n, c]) => (
            <div key={l as string} className="rounded-lg border border-line bg-surface px-4 py-3">
              <p className="text-sm text-muted">{l}</p>
              <p className="num text-2xl font-bold" style={{ color: c as string, textAlign: 'right' }}>{n}</p>
            </div>
          ))}
        </div>
        {ex.axes.map((a) => (
          <section key={a.id}>
            <h2 className="mb-3 text-lg font-bold text-ink">{a.title}</h2>
            <div className="space-y-5">
              {a.goals.map((g) => (
                <div key={g.id}>
                  <h3 className="mb-2 font-semibold text-teal">{g.title}</h3>
                  {g.kpis.length === 0 ? (
                    <p className="text-sm text-muted">لا مؤشرات مرتبطة بهذا الهدف.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {g.kpis.map((kp) => (
                        <KpiCard key={kp.id} kpi={kp} dept={deptName(depts, kp.department_id, true)} href={`/dashboard/kpi/${kp.id}?year=${period.year}&q=${period.quarter}`} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
}
