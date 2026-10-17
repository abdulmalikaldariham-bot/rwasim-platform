import { requireSession } from '@/lib/auth';
import { deptName, getDepartments, resolvePeriod } from '@/lib/data/common';
import { getBoundaries, loadActivities } from '@/lib/data/plans';
import { ActivityCard } from '@/components/activity-card';
import { EmptyState, PageHeader } from '@/components/ui';
import { PeriodPicker } from '@/components/period-picker';
import { ActivityFilters } from './filters';
import { QUARTER_LABEL } from '@/lib/labels';

export const metadata = { title: 'متابعة الأنشطة' };

type SP = { year?: string; q?: string; dept?: string; state?: string; s?: string; weights?: string };

export default async function Activities({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession(['executive_director', 'dept_manager', 'board_member']);
  const period = await resolvePeriod(sb, sp);
  const depts = await getDepartments(sb, true);
  const { data: plans } = await sb.from('op_plans').select('id,department_id,status').eq('year', period.year).eq('quarter', period.quarter).in('status', ['approved', 'archived']);
  const visible = (plans ?? []).filter((p) => !sp.dept || p.department_id === sp.dept);
  const b = await getBoundaries(sb, period.year, period.quarter);
  const acts = await loadActivities(sb, visible.map((p) => p.id), Object.fromEntries(visible.map((p) => [p.id, b])), period.today);
  const deptOf = (planId: string) => visible.find((p) => p.id === planId)!.department_id;
  const stateMatch = (st: string) => (sp.state === 'not_started' ? st === 'not_started' || st === 'upcoming' : st === sp.state);
  const q = (sp.s ?? '').trim();
  const filtered = acts
    .filter((a) => !sp.state || stateMatch(a.eval.state))
    .filter((a) => !q || a.title.includes(q) || a.steps.some((s) => s.title.includes(q) || (s.responsible_text ?? '').includes(q)));
  const order = { stalled: 0, late: 1, in_progress: 2, not_started: 3, upcoming: 4, completed: 5 } as const;
  filtered.sort((x, y) => order[x.eval.state] - order[y.eval.state]);
  const showWeights = sp.weights === '1';
  const canPickDept = profile.role !== 'dept_manager';

  return (
    <>
      <PageHeader
        title="متابعة الأنشطة"
        sub={`${QUARTER_LABEL[period.quarter]} ${period.year}م — ${filtered.length} نشاطًا${profile.role === 'dept_manager' ? ' في خطة إدارتك' : ''}`}
        actions={<PeriodPicker years={period.years.map((y) => y.year)} year={period.year} quarter={period.quarter} />}
      />
      <ActivityFilters depts={canPickDept ? depts.map((d) => ({ id: d.id, name: d.short_name ?? d.name })) : []} showWeights={showWeights} />
      {filtered.length === 0 ? (
        <EmptyState title="لا أنشطة مطابقة" body="غيّر عوامل التصفية، أو تأكد من وجود خطط معتمدة لهذا الربع." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((a) => (
            <ActivityCard key={a.id} a={a} dept={deptName(depts, deptOf(a.plan_id), true)} href={`/activities/${a.id}${showWeights ? '?weights=1' : ''}`} showWeight={showWeights} />
          ))}
        </div>
      )}
    </>
  );
}
