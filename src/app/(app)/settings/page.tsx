import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getDepartments, getSetting, resolvePeriod } from '@/lib/data/common';
import { PageHeader, Panel, PanelHead, Pill } from '@/components/ui';
import { YearsPanel, WeeksPanel, DepartmentsPanel, DeptWeightsPanel, StaleSetting } from './settings-client';
import { QUARTER_LABEL } from '@/lib/labels';

export const metadata = { title: 'الإعدادات' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  const sp = await searchParams;
  const { sb, profile } = await requireSession(['executive_director', 'system_admin']);
  const period = await resolvePeriod(sb, sp);
  const isEd = profile.role === 'executive_director';
  const [depts, weeks, weights, stale] = await Promise.all([
    getDepartments(sb, true),
    sb.from('quarter_weeks').select('*').eq('year', period.year).eq('quarter', period.quarter).order('week_index'),
    sb.rpc('get_dept_weights', { p_year: period.year }),
    getSetting<number>(sb, 'stale_after_days', 14),
  ]);
  const ws = (weights.data ?? []) as { department_id: string; weight: number; set_version: number }[];
  return (
    <>
      <PageHeader
        title="الإعدادات"
        sub={isEd ? 'السنوات، والهيكل، والأوزان، وحدود الأسابيع.' : 'الإعدادات الفنية. قرارات الهيكل والأوزان من صلاحية المدير التنفيذي.'}
        actions={
          <div className="flex gap-2">
            <Link href="/settings/users" className="text-sm text-teal underline">المستخدمون</Link>
            <Link href="/settings/audit" className="text-sm text-teal underline">سجل التغييرات</Link>
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHead title="السنوات" hint="كل سنة تُنشأ بحدود أسابيعها وأوزان إداراتها، وتؤرشف بعد انتهائها." />
          <div className="px-5 pb-5">
            <YearsPanel years={period.years} canEdit={isEd} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title={`أوزان الإدارات لسنة ${period.year}م`} hint={`تستخدم في معادلة إنجاز الجمعية فقط ولا تظهر في اللوحة. ${ws[0] ? `الإصدار المعتمد: ${ws[0].set_version}` : ''}`} />
          <div className="px-5 pb-5">
            <DeptWeightsPanel year={period.year} canEdit={isEd} depts={depts.map((d) => ({ id: d.id, name: d.name, active: d.is_active, weight: Number(ws.find((w) => w.department_id === d.id)?.weight ?? 0) }))} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="الإدارات" hint="أضف إدارة أو أعد تسميتها أو عطّلها. التعطيل يحفظ بياناتها التاريخية." />
          <div className="px-5 pb-5">
            <DepartmentsPanel depts={depts.map((d) => ({ id: d.id, name: d.name, short_name: d.short_name, active: d.is_active, code: d.code }))} canEdit={isEd} />
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title={`حدود أسابيع ${QUARTER_LABEL[period.quarter]} ${period.year}م`}
            hint="الافتراضي: الأسبوع 1 = الأيام 1–7، و2 = 8–14، و3 = 15–21، و4 = 22 إلى نهاية الشهر. راجعها إن كانت الخطة تعتمد أسابيع مختلفة."
            action={(weeks.data ?? []).every((w) => w.is_reviewed) ? <Pill tone="done">مراجعة</Pill> : <Pill tone="late">بحاجة لمراجعة</Pill>}
          />
          <div className="px-5 pb-5">
            <div className="mb-3 flex gap-1.5">
              {[1, 2, 3, 4].map((q) => (
                <Link key={q} href={`/settings?year=${period.year}&q=${q}`} className={`rounded-full border px-3 py-1 text-sm ${q === period.quarter ? 'border-teal bg-teal-soft text-teal' : 'border-line text-muted'}`}>
                  ر{q}
                </Link>
              ))}
            </div>
            <WeeksPanel year={period.year} quarter={period.quarter} weeks={(weeks.data ?? []).map((w) => ({ weekIndex: w.week_index, month: w.month, wom: w.week_of_month, start: w.start_date, end: w.end_date }))} canEdit={isEd} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="تحديث البيانات" hint="تعتبر بيانات الإدارة «قديمة» إذا لم تُحدَّث خلال هذه المدة رغم وجود أعمال مستحقة." />
          <div className="px-5 pb-5">
            <StaleSetting value={stale} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="القوالب والنسخ الاحتياطي" />
          <div className="space-y-2 px-5 pb-5 text-sm">
            <p>
              <a className="text-teal underline" href={`/api/templates/operational?year=${period.year}&q=${period.quarter}`}>قالب الخطة التشغيلية الربعية</a> —{' '}
              <a className="text-teal underline" href={`/api/templates/executive?year=${period.year + 1}`}>قالب الخطة التنفيذية {period.year + 1}م</a>
            </p>
            <p className="text-muted">
              النسخ الاحتياطي اليومي تديره Supabase تلقائيًا في الخطة المدفوعة. وللنسخ اليدوي وتصدير قاعدة البيانات والاستعادة، اتبع «دليل النشر والتشغيل» (سكربت backup/restore).
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
