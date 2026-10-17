import { KeyRound, MonitorPlay, ShieldCheck } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { getYears } from '@/lib/data/common';
import { EmptyState, PageHeader, Pill } from '@/components/ui';
import { LinkActions, LinkEditor, type LinkRow } from './share-client';
import { QUARTER_LABEL } from '@/lib/labels';
import { fmtDateTime, fmtDateY } from '@/lib/format';

export const metadata = { title: 'روابط عرض الأداء' };

export default async function SharePage() {
  const { sb } = await requireSession(['executive_director']);
  const [years, { data: links }, { data: kpis }] = await Promise.all([
    getYears(sb),
    sb.from('share_links').select('*').order('created_at', { ascending: false }),
    sb.from('kpis').select('id,name,sort_order,exec_plans!inner(year,status)').order('sort_order'),
  ]);
  const yearList = years.map((y) => y.year);
  const kpiOptions = (kpis ?? []).map((k) => ({ id: k.id, name: k.name }));

  return (
    <>
      <PageHeader
        title="روابط عرض الأداء"
        sub="روابط مستقلة تعرض لوحة الأداء المؤسسي المعتمدة على شاشة المقر أو لمجلس الإدارة والجهات المعنية، دون دخول المنصة."
        actions={<LinkEditor kpis={kpiOptions} years={yearList} defaultYear={yearList[0]} />}
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          [<MonitorPlay key="i" size={18} />, 'مصممة للشاشات الكبيرة', 'صفحة واحدة بنسبة 16:9 دون تمرير، مع ملء الشاشة والتحديث التلقائي.'],
          [<ShieldCheck key="i" size={18} />, 'بيانات معتمدة فقط', 'التحقق في قاعدة البيانات: لا توجيهات ولا ملاحظات ولا شواهد ولا أسماء موظفين.'],
          [<KeyRound key="i" size={18} />, 'تحكم كامل', 'رمز وصول اختياري، وتاريخ انتهاء، وتعطيل أو إلغاء في أي وقت.'],
        ].map(([i, t, d]) => (
          <div key={t as string} className="card flex gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-soft text-late">{i}</span>
            <span>
              <span className="block text-sm font-bold text-ink">{t}</span>
              <span className="block text-xs text-muted">{d}</span>
            </span>
          </div>
        ))}
      </div>
      {(links ?? []).length === 0 ? (
        <EmptyState title="لا توجد روابط عرض بعد" body="أنشئ رابطًا لعرض لوحة الأداء على شاشة المقر أو لمشاركتها مع مجلس الإدارة." action={<LinkEditor kpis={kpiOptions} years={yearList} defaultYear={yearList[0]} />} />
      ) : (
        <ul className="space-y-3">
          {(links as (LinkRow & { view_count: number; last_viewed_at: string | null; created_at: string; locked_until: string | null })[]).map((l) => {
            const expired = l.expires_at && isPast(l.expires_at);
            const state = !l.is_active ? ['معطّل', 'nodata'] : expired ? ['منتهي الصلاحية', 'late'] : ['فعّال', 'done'];
            return (
              <li key={l.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-ink">{l.name}</h2>
                      <Pill tone={state[1] as 'done'}>{state[0]}</Pill>
                      {l.access_mode === 'code' && (
                        <Pill tone="teal">
                          <KeyRound size={12} /> برمز وصول
                        </Pill>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {l.quarter ? `${QUARTER_LABEL[l.quarter]} ${l.year}م` : `الربع الجاري من ${l.year}م`}
                      {l.allow_period_nav && ' · يسمح بالتنقل بين الفترات'}
                      {' · '}
                      {[l.sections.ops && 'الأداء التشغيلي', l.sections.exec && 'الأداء التنفيذي'].filter(Boolean).join(' و')}
                      {l.expires_at && ` · ينتهي ${fmtDateY(l.expires_at)}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {l.view_count} مشاهدة · آخر عرض {l.last_viewed_at ? fmtDateTime(l.last_viewed_at) : '—'} · أُنشئ {fmtDateTime(l.created_at)}
                    </p>
                  </div>
                  <LinkActions link={l} kpis={kpiOptions} years={yearList} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function isPast(iso: string) {
  return new Date(iso).getTime() < Date.now();
}
