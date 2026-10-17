import { requireSession } from '@/lib/auth';
import { getDepartments } from '@/lib/data/common';
import { PageHeader, Panel } from '@/components/ui';
import { NewUser, UserRow } from './users-client';

export const metadata = { title: 'المستخدمون' };

export default async function Users() {
  const { sb, profile } = await requireSession(['executive_director', 'system_admin']);
  const depts = await getDepartments(sb, true);
  const { data: users } = await sb.from('profiles').select('*').order('role').order('full_name');
  const d = depts.map((x) => ({ id: x.id, name: x.name }));
  return (
    <>
      <PageHeader back={{ href: '/settings', label: 'الإعدادات' }} title="المستخدمون والصلاحيات" sub="الدور يحدد ما يراه المستخدم ويعدله، ويُطبق داخل قاعدة البيانات نفسها." actions={<NewUser depts={d} />} />
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              {['المستخدم', 'الدور', 'الإدارة', 'الحالة', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <UserRow key={u.id} u={u} depts={d} self={u.id === profile.id} />
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        المدير التنفيذي: كل الصلاحيات والاعتمادات. مدير الإدارة: خطة إدارته وتفويض موظفيها. الموظف المفوض: مهامه فقط. عضو مجلس الإدارة: قراءة الخطط والتقارير المعتمدة. مسؤول النظام: المستخدمون والإعدادات الفنية دون قرارات إدارية.
      </p>
    </>
  );
}
