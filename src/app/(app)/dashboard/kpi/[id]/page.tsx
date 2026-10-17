import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, resolvePeriod } from '@/lib/data/common';
import { loadExecPlan } from '@/lib/data/kpis';
import { PageHeader, Panel, PanelHead, Pill, ProgressBar, stateTone } from '@/components/ui';
import { MeasurementForm } from './measurement-form';
import { FREQUENCY, KPI_STATUS, KPI_TYPE } from '@/lib/labels';
import { fmtDateY, fmtNum, fmtPct } from '@/lib/format';

export default async function KpiDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ year?: string; q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, profile } = await requireSession();
  const { data: row } = await sb.from('kpis').select('id,exec_plans(year)').eq('id', id).maybeSingle();
  if (!row) notFound();
   
  const year = (row as any).exec_plans.year as number;
  const period = await resolvePeriod(sb, { ...sp, year: String(year) });
  const ex = await loadExecPlan(sb, year, period.quarter);
  const k = ex.kpis.find((x) => x.id === id)!;
  const depts = await getDepartments(sb, true);
  const goal = ex.axes.flatMap((a) => a.goals.map((g) => ({ a, g }))).find((x) => x.g.kpis.some((y) => y.id === id));
  const [{ data: meas }, { data: acts }] = await Promise.all([
    sb.from('kpi_measurements').select('id,measured_on,quarter,value,note,profiles(full_name)').eq('kpi_id', id).order('measured_on', { ascending: false }),
    sb.from('activities').select('id,title,op_plans(quarter,department_id)').eq('kpi_id', id),
  ]);
  const canMeasure = k.actual_mode === 'manual' && ex.plan?.status === 'approved' && (profile.role === 'executive_director' || (profile.role === 'dept_manager' && profile.department_id === k.department_id));
  const unit = k.unit ?? '';
  return (
    <>
      <PageHeader back={{ href: `/dashboard?axis=exec&year=${year}&q=${period.quarter}`, label: 'الأداء التنفيذي' }} title={k.name} sub={goal ? `${goal.a.title} ← ${goal.g.title}` : undefined} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted">المتحقق</p>
              <p className="num text-4xl font-bold text-ink" style={{ textAlign: 'right' }}>
                {fmtNum(k.actual)} <span className="text-lg text-muted">{unit}</span>
              </p>
            </div>
            <Pill tone={stateTone(k.evaluation.status)}>{KPI_STATUS[k.evaluation.status]}</Pill>
          </div>
          <div className="mt-4">
            <ProgressBar value={k.evaluation.achievement === null ? null : Math.min(100, Math.max(0, k.evaluation.achievement))} size="lg" tone={stateTone(k.evaluation.status) === 'nodata' ? 'teal' : stateTone(k.evaluation.status)} />
            <p className="mt-1.5 text-sm text-muted">
              نسبة التحقق من المستهدف السنوي <span className="num font-semibold text-text">{fmtPct(k.evaluation.achievement)}</span>
            </p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              ['المستهدف السنوي', `${fmtNum(k.annual_target)} ${unit}`],
              ['خط الأساس', k.baseline === null ? '—' : `${fmtNum(k.baseline)} ${unit}`],
              ['المتوقع حتى الربع الحالي', k.evaluation.expected === null ? '—' : `${fmtNum(k.evaluation.expected)} ${unit}`],
              ['المستهدفات المرحلية', [1, 2, 3, 4].map((q) => (k.periodTargets[q] !== undefined ? `ر${q}: ${fmtNum(k.periodTargets[q])}` : null)).filter(Boolean).join('، ') || '—'],
              ['النوع', KPI_TYPE[k.kpi_type]],
              ['اتجاه التحسن', k.direction === 'increase' ? 'الزيادة' : 'الانخفاض'],
              ['الإدارة المسؤولة', deptName(depts, k.department_id)],
              ['دورية القياس', FREQUENCY[k.frequency]],
              ['مصدر القيمة', k.actual_mode === 'derived_count' ? 'مشتقة: عدد الأنشطة المرتبطة المكتملة' : 'إدخال مباشر'],
              ['آخر قياس', fmtDateY(k.measuredOn)],
            ].map(([a, b]) => (
              <div key={a} className="contents">
                <dt className="text-muted">{a}</dt>
                <dd>{b}</dd>
              </div>
            ))}
          </dl>
          {(k.definition || k.calc_method || k.data_source) && (
            <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
              {k.definition && <p><span className="text-muted">التعريف: </span>{k.definition}</p>}
              {k.calc_method && <p><span className="text-muted">طريقة الاحتساب: </span>{k.calc_method}</p>}
              {k.data_source && <p><span className="text-muted">مصدر البيانات والشواهد: </span>{k.data_source}</p>}
            </div>
          )}
        </Panel>
        <div className="space-y-6">
          {canMeasure && (
            <Panel>
              <PanelHead title="تسجيل قياس جديد" hint="القيمة تراكمية حتى تاريخ القياس" />
              <div className="px-5 pb-5">
                <MeasurementForm kpiId={k.id} />
              </div>
            </Panel>
          )}
          <Panel>
            <PanelHead title="سجل القياسات" />
            <ul className="divide-y divide-line px-5 pb-3">
              {(meas ?? []).length === 0 && <li className="py-3 text-sm text-muted">لا قياسات بعد.</li>}
              { }
              {(meas ?? []).map((m: any) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="num font-semibold" style={{ textAlign: 'right' }}>{fmtNum(Number(m.value))} {unit}</p>
                    {m.note && <p className="text-muted">{m.note}</p>}
                  </div>
                  <p className="text-xs text-muted">
                    {fmtDateY(m.measured_on)}
                    <br />
                    {m.profiles?.full_name}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHead title="البرامج والمبادرات المرتبطة" hint="أنشطة الخطط التشغيلية المرتبطة بهذا المؤشر" />
            <ul className="space-y-1 px-5 pb-5 text-sm">
              {(acts ?? []).length === 0 && <li className="text-muted">لم تُربط أنشطة بعد. يُربط النشاط بالمؤشر من صفحة الخطة.</li>}
              { }
              {(acts ?? []).map((a: any) => (
                <li key={a.id}>
                  <Link href={`/activities/${a.id}`} className="text-teal hover:underline">
                    {a.title}
                  </Link>{' '}
                  <span className="text-muted">— {deptName(depts, a.op_plans?.department_id, true)}، ر{a.op_plans?.quarter}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
