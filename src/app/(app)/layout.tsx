import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { ROLE_LABELS } from '@/lib/labels';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, sb } = await requireSession();
  // من أُنشئ حسابه أو أُعيد تعيينه يعين كلمة مروره أولًا
  if ((profile as { must_change_password?: boolean }).must_change_password) redirect('/set-password');
  let deptName: string | null = null;
  if (profile.department_id) {
    const { data } = await sb.from('departments').select('name').eq('id', profile.department_id).single();
    deptName = data?.name ?? null;
  }
  let pendingApprovals = 0;
  if (profile.role === 'executive_director') {
    const [p, c] = await Promise.all([
      sb.from('op_plans').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      sb.from('change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    pendingApprovals = (p.count ?? 0) + (c.count ?? 0);
  }
  return (
    <Shell
      role={profile.role}
      user={{ name: profile.full_name, roleLabel: ROLE_LABELS[profile.role], dept: deptName }}
      badges={{ '/executive': pendingApprovals }}
    >
      {children}
    </Shell>
  );
}
