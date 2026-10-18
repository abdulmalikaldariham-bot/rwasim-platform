import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, getSetting, resolvePeriod } from '@/lib/data/common';
import { evaluateQuarter, loadYearProgress } from '@/lib/data/progress';
import { getBoundaries, loadActivities } from '@/lib/data/plans';
import { loadExecPlan } from '@/lib/data/kpis';
import { PageHeader, Panel, PanelHead, Pill, stateTone, EmptyState } from '@/components/ui';
import { DirectiveForm, DirectiveRow, EscalationResolve } from './executive-client';
import { ACTIVITY_STATE, DATA_STATE, KPI_STATUS, QUARTER_LABEL, REPORT_TYPE } from '@/lib/labels';
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format';

export const metadata = { title: 'مركز المتابعة التنفيذية' };

export default async function ExecutiveCenter() {
  const { sb } = await requireSession(['executive_director']);
  const period = await resolvePeriod(sb, {});
  const depts = await getDepartments(sb, true);
  const staleDays = await getSetting<number>(sb, 'stale_after_days', 14);
  const yp = await loadYearProgress(sb, period.year);
  const org = evaluateQuarter(yp, period.quarter, { asOf: period.today, staleAfterDays: staleDays });
  const planIds = yp.plans.filter((p) => p.quarter === period.quarter && p.status === 'approved').map((p) => p.id);
  const b = await getBoundaries(sb, period.year, period.quarter);
  const acts = await loadActivities(sb, planIds, Object.fromEntries(planIds.map((id) => [id, b])), period.today);
  const planDept = Object.fromEntries(yp.plans.map((p) => [p.id, p.departmentId]));
  const wDept = Object.fromEntries(yp.weights.map((w) => [w.departmentId, w.weight]));

  // أثر التأخر على إنجاز الجمعية = وزن الإدارة × وزن النشاط × الفجوة بين المخطط والمتحقق
  const impact = (a: (typeof acts)[number]) => ((wDept[planDept[a.plan_id]] ?? 0) * a.weight * Math.max(0, a.eval.planned - a.eval.progress)) / 10000;
  const stalled = acts.filter((a) => a.eval.state === 'stalled');
  const late = acts.filter((a) => a.eval.state === 'late').sort((x, y) => impact(y) - impact(x));
  const ex = await loadExecPlan(sb, period.year, period.quarter);
  const deviating = ex.kpis.filter((k) => k.evaluation.status === 'off_track' || k.evaluation.status === 'at_risk');
  const silent = org.departments.filter((d) => d.dataState !== 'ok');

  const [{ data: esc }, { data: submitted }, { data: requests }, { data: drafts }, { data: directives }, { data: people }] = await Promise.all([
    sb.from('escalations').select('id,kind,title,details,department_id,step_id,activity_id,created_at,profiles!escalations_raised_by_fkey(full_name)').eq('status', 'open').order('created_at', { ascending: false }),
    sb.from('op_plans').select('id,department_id,quarter,year,submitted_at').eq('status', 'submitted'),
    sb.from('change_requests').select('id,plan_id,kind,reason,requested_at,op_plans(department_id,quarter,year)').eq('status', 'pending'),
    sb.from('reports').select('id,title,type,generated_at').eq('status', 'draft').order('generated_at', { ascending: false }),
    sb.from('directives').select('*,assignee:profiles!directives_assignee_id_fkey(full_name),directive_updates(note,created_at,status)').order('created_at', { ascending: false }).limit(50),
    sb.from('profiles').select('id,full_name,department_id,role').eq('is_active', true).order('full_name'),
  ]);
  const decisions = (esc ?? []).filter((e) => e.kind === 'decision');
  const guidance = (esc ?? []).filter((e) => e.kind !== 'decision');
  const approvals = (submitted ?? []).length + (requests ?? []).length + (drafts ?? []).length;
  const attention = stalled.length + late.length + deviating.length + silent.length + (esc ?? []).length;

  return (
    <>
      <PageHeader title="مركز المتابعة التنفيذية" sub={`ما يحتاج إلى قرارك في ${QUARTER_LABEL[period.quarter]} ${period.year}م. هذا القسم يظهر لحسابك فقط.`} />

      <section aria-labelledby="att" className="mb-8">
        <h2 id="att" className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
          ما الذي يحتاج إلى تدخلك؟ <Pill tone={attention ? 'orange' : 'done'}>{attention}</Pill>
        </h2>
        {attention === 0 ? (
          <EmptyState title="لا شيء يحتاج تدخلك الآن" body="لا تعثرات ولا انحرافات ولا طلبات معلقة." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {stalled.length > 0 && (
              <Panel>
                <PanelHead title="الأنشطة المتعثرة" hint="متأخرة أكثر من أسبوعين أو معلّقة" />
                <ActList items={stalled} depts={depts} planDept={planDept} />
              </Panel>
            )}
            {late.length > 0 && (
              <Panel>
                <PanelHead title="التأخر المؤثر في الخطة" hint="مرتبة حسب أثرها على إنجاز الجمعية" />
                <ActList items={late.slice(0, 8)} depts={depts} planDept={planDept} impact={impact} />
              </Panel>
            )}
            {deviating.length > 0 && (
              <Panel>
                <PanelHead title="مؤشرات منحرفة عن المستهدف" />
                <ul className="divide-y divide-line border-t border-line">
                  {deviating.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <Link href={`/dashboard/kpi/${k.id}`} className="hover:text-teal">
                        {k.name}
                        <span className="block text-xs text-muted">{deptName(depts, k.department_id, true)} — التحقق {fmtPct(k.evaluation.periodAchievement)} من المتوقع</span>
                      </Link>
                      <Pill tone={stateTone(k.evaluation.status)}>{KPI_STATUS[k.evaluation.status]}</Pill>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {silent.length > 0 && (
              <Panel>
                <PanelHead title="إدارات تحتاج متابعة بياناتها" />
                <ul className="divide-y divide-line border-t border-line">
                  {silent.map((d) => (
                    <li key={d.departmentId} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <Link href={`/workspace?dept=${d.departmentId}`} className="hover:text-teal">
                        {deptName(depts, d.departmentId)}
                        <span className="block text-xs text-muted">آخر تحديث: {fmtDateTime(d.lastUpdateAt)}</span>
                      </Link>
                      <Pill tone={stateTone(d.dataState)}>{DATA_STATE[d.dataState]}</Pill>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {decisions.length > 0 && (
              <Panel>
                <PanelHead title="قرارات مطلوبة" hint="مرفوعة من الإدارات" />
                <EscList items={decisions} depts={depts} />
              </Panel>
            )}
            {guidance.length > 0 && (
              <Panel>
                <PanelHead title="أمور تحتاج توجيهًا إداريًا" hint="تعثرات وعوائق مرفوعة من الفرق" />
                <EscList items={guidance} depts={depts} />
              </Panel>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="apr" className="mb-8">
        <h2 id="apr" className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
          الاعتمادات <Pill tone={approvals ? 'orange' : 'done'}>{approvals}</Pill>
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel>
            <PanelHead title="خطط بانتظار الاعتماد" />
            <ul className="space-y-1 px-5 pb-4 text-sm">
              {(submitted ?? []).length === 0 && <li className="text-muted">لا توجد.</li>}
              {(submitted ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/plans/${p.id}`} className="text-teal hover:underline">
                    {deptName(depts, p.department_id)} — ر{p.quarter} {p.year}
                  </Link>
                  <span className="block text-xs text-muted">رُفعت {fmtDateTime(p.submitted_at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHead title="تعديلات على خطط معتمدة" hint="أوزان أو هيكل أو جدولة" />
            <ul className="space-y-1 px-5 pb-4 text-sm">
              {(requests ?? []).length === 0 && <li className="text-muted">لا توجد.</li>}
              { }
              {(requests ?? []).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/plans/${r.plan_id}`} className="text-teal hover:underline">
                    {deptName(depts, r.op_plans?.department_id)} — {{ weights: 'أوزان', structure: 'هيكل', schedule: 'جدولة' }[r.kind as 'weights']}
                  </Link>
                  <span className="block text-xs text-muted">{r.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHead title="تقارير بانتظار المراجعة" />
            <ul className="space-y-1 px-5 pb-4 text-sm">
              {(drafts ?? []).length === 0 && <li className="text-muted">لا توجد.</li>}
              {(drafts ?? []).map((r) => (
                <li key={r.id}>
                  <Link href={`/reports/${r.id}`} className="text-teal hover:underline">
                    {r.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {REPORT_TYPE[r.type]} — {fmtDateTime(r.generated_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      <section aria-labelledby="dir">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="dir" className="text-lg font-bold text-ink">
            التوجيهات والمتابعة
          </h2>
          <DirectiveForm
            depts={depts.filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.name }))}
            people={(people ?? []).filter((p) => p.role !== 'board_member').map((p) => ({ id: p.id, name: p.full_name, dept: p.department_id }))}
            activities={acts.map((a) => ({ id: a.id, title: a.title, dept: planDept[a.plan_id] }))}
            kpis={ex.kpis.map((k) => ({ id: k.id, name: k.name }))}
          />
        </div>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                {['التوجيه', 'مرتبط بـ', 'المسؤول', 'تاريخ التوجيه', 'الموعد', 'الحالة', 'آخر تحديث', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(directives ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-muted">
                    لا توجيهات بعد.
                  </td>
                </tr>
              )}
              { }
              {(directives ?? []).map((d: any) => (
                <DirectiveRow
                  key={d.id}
                  d={{
                    id: d.id,
                    title: d.title,
                    body: d.body,
                    target:
                      d.target_type === 'department'
                        ? deptName(depts, d.department_id)
                        : d.target_type === 'activity'
                          ? acts.find((a) => a.id === d.activity_id)?.title ?? 'نشاط'
                          : d.target_type === 'kpi'
                            ? ex.kpis.find((k) => k.id === d.kpi_id)?.name ?? 'مؤشر'
                            : 'عام',
                    assignee: d.assignee?.full_name ?? '—',
                    created: fmtDate(d.created_at),
                    due: d.due_date ? fmtDate(d.due_date) : '—',
                    overdue: d.status !== 'closed' && d.due_date && d.due_date < period.today,
                    status: d.status,
                    last: d.directive_updates?.sort((x: { created_at: string }, y: { created_at: string }) => (x.created_at < y.created_at ? 1 : -1))[0] ?? null,
                    updatedAt: fmtDateTime(d.updated_at),
                  }}
                />
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </>
  );
}

function ActList({
  items,
  depts,
  planDept,
  impact,
}: {
  items: { id: string; title: string; plan_id: string; eval: { state: string; progress: number; planned: number; lateSteps: number } }[];
  depts: { id: string; name: string; short_name: string | null }[];
  planDept: Record<string, string>;
   
  impact?: (a: any) => number;
}) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {items.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
          <Link href={`/activities/${a.id}`} className="min-w-0 hover:text-teal">
            <span className="block truncate font-medium">{a.title}</span>
            <span className="block text-xs text-muted">
              {deptName(depts as never, planDept[a.plan_id], true)} — منجز {fmtPct(a.eval.progress)} من مخطط {fmtPct(a.eval.planned)} — {a.eval.lateSteps} مهام متأخرة
              {impact ? ` — أثره على الجمعية ${fmtPct(Math.round(impact(a) * 100) / 100)}` : ''}
            </span>
          </Link>
          <Pill tone={stateTone(a.eval.state)}>{ACTIVITY_STATE[a.eval.state as 'late']}</Pill>
        </li>
      ))}
    </ul>
  );
}

function EscList({
  items,
  depts,
}: {
   
  items: any[];
  depts: { id: string; name: string; short_name: string | null }[];
}) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {items.map((e) => (
        <li key={e.id} className="px-5 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{e.title}</p>
              {e.details && <p className="text-muted">{e.details}</p>}
              <p className="text-xs text-muted">
                {deptName(depts as never, e.department_id, true)} — {e.profiles?.full_name} — {fmtDateTime(e.created_at)}
                {e.activity_id && (
                  <>
                    {' '}
                    —{' '}
                    <Link className="text-teal underline" href={`/activities/${e.activity_id}`}>
                      النشاط
                    </Link>
                  </>
                )}
              </p>
            </div>
            <EscalationResolve id={e.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const dynamic = 'force-dynamic';
