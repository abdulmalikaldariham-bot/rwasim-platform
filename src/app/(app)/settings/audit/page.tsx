import { requireSession } from '@/lib/auth';
import { PageHeader, Panel } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'سجل التغييرات' };

const TABLES: Record<string, string> = {
  op_plans: 'الخطط التشغيلية',
  activities: 'الأنشطة',
  steps: 'المهام',
  step_weeks: 'الجدولة',
  substeps: 'المراحل الفرعية',
  kpis: 'المؤشرات',
  kpi_period_targets: 'المستهدفات المرحلية',
  kpi_measurements: 'القياسات',
  exec_plans: 'الخطة التنفيذية',
  dept_weight_sets: 'أوزان الإدارات',
  profiles: 'المستخدمون',
  departments: 'الإدارات',
  years: 'السنوات',
  quarter_weeks: 'حدود الأسابيع',
  change_requests: 'طلبات التعديل',
  directives: 'التوجيهات',
  reports: 'التقارير',
  settings: 'الإعدادات',
};
const ACTIONS: Record<string, string> = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };
const IGNORED = new Set(['updated_at', 'created_at', 'last_update_at', 'last_update_by']);

function changes(o: Record<string, unknown> | null, n: Record<string, unknown> | null) {
  if (!o || !n) return '';
  return Object.keys(n)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]) && k !== 'snapshot' && k !== 'parsed')
    .map((k) => `${k}: ${JSON.stringify(o[k])} ← ${JSON.stringify(n[k])}`)
    .join('، ')
    .slice(0, 240);
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ t?: string; page?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireSession(['executive_director', 'system_admin']);
  const page = Math.max(0, Number(sp.page) || 0);
  let q = sb.from('audit_log').select('*').order('at', { ascending: false }).range(page * 100, page * 100 + 99);
  if (sp.t) q = q.eq('table_name', sp.t);
  const { data: rows } = await q;
  const actorIds = [...new Set((rows ?? []).map((r) => r.actor).filter(Boolean))];
  const { data: actors } = await sb.from('profiles').select('id,full_name').in('id', actorIds.length ? actorIds : ['00000000-0000-0000-0000-000000000000']);
  return (
    <>
      <PageHeader back={{ href: '/settings', label: 'الإعدادات' }} title="سجل التغييرات" sub="كل تعديل على الخطط والأوزان والمؤشرات والمستخدمين يُسجل تلقائيًا ولا يمكن حذفه من الواجهة." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/settings/audit" className={`rounded-full border px-3 py-1 text-xs ${!sp.t ? 'border-teal bg-teal-soft text-teal' : 'border-line text-muted'}`}>
          الكل
        </Link>
        {Object.entries(TABLES).map(([k, l]) => (
          <Link key={k} href={`/settings/audit?t=${k}`} className={`rounded-full border px-3 py-1 text-xs ${sp.t === k ? 'border-teal bg-teal-soft text-teal' : 'border-line text-muted'}`}>
            {l}
          </Link>
        ))}
      </div>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              {['الوقت', 'المستخدم', 'السجل', 'العملية', 'التفاصيل'].map((h) => (
                <th key={h} className="px-4 py-3 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(r.at)}</td>
                <td className="px-4 py-2">{actors?.find((a) => a.id === r.actor)?.full_name ?? (r.actor ? '—' : 'النظام')}</td>
                <td className="px-4 py-2">{TABLES[r.table_name] ?? r.table_name}</td>
                <td className="px-4 py-2">{ACTIONS[r.action]}</td>
                <td className="px-4 py-2 text-xs text-muted" dir="auto">
                  {r.action === 'UPDATE' ? changes(r.old_data, r.new_data) : String((r.new_data ?? r.old_data)?.title ?? (r.new_data ?? r.old_data)?.name ?? (r.new_data ?? r.old_data)?.full_name ?? '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="mt-4 flex gap-3 text-sm">
        {page > 0 && <Link href={`/settings/audit?${new URLSearchParams({ ...(sp.t ? { t: sp.t } : {}), page: String(page - 1) })}`} className="text-teal underline">الأحدث</Link>}
        {(rows ?? []).length === 100 && <Link href={`/settings/audit?${new URLSearchParams({ ...(sp.t ? { t: sp.t } : {}), page: String(page + 1) })}`} className="text-teal underline">الأقدم</Link>}
      </div>
    </>
  );
}
