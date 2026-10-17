import { requireSession } from '@/lib/auth';
import { getYears } from '@/lib/data/common';
import { PageHeader } from '@/components/ui';
import { ShareLinksClient, type LinkRow } from './share-links-client';

export const metadata = { title: 'روابط عرض الأداء' };

export default async function ShareLinksPage() {
  const { sb } = await requireSession(['executive_director']);
  const [{ data: links }, years, { data: kpis }] = await Promise.all([
    sb
      .from('share_links')
      .select('id,token,name,follow_current,year,quarter,allow_period_switch,show_operational,show_executive,show_activities,kpi_ids,kpi_limit,refresh_seconds,access_code_hash,expires_at,is_active,revoked_at,created_at,last_viewed_at,view_count')
      .order('created_at', { ascending: false }),
    getYears(sb),
    sb.from('kpis').select('id,name,sort_order,exec_plans!inner(year,status)').order('sort_order'),
  ]);
  const rows: LinkRow[] = (links ?? []).map(({ access_code_hash, ...l }) => ({ ...l, protected: !!access_code_hash }));
  return (
    <>
      <PageHeader
        title="روابط عرض الأداء"
        sub="روابط آمنة تعرض لوحة أداء مبسطة دون تسجيل دخول — للشاشات والتلفاز والجوال. تعرض أرقامًا من الخطط المعتمدة فقط، ولا تتضمن التوجيهات أو الملاحظات أو بيانات الموظفين أو الملفات."
      />
      <ShareLinksClient
        links={rows}
        years={years.map((y) => y.year)}
         
        kpis={(kpis ?? []).map((k: any) => ({ id: k.id, name: k.name, year: k.exec_plans?.year as number }))}
      />
    </>
  );
}
