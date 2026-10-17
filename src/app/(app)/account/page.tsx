import { requireSession } from '@/lib/auth';
import { PageHeader, Panel } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/labels';
import { PasswordForm } from './password-form';

export const metadata = { title: 'حسابي' };

export default async function Account() {
  const { profile } = await requireSession();
  return (
    <>
      <PageHeader title="حسابي" sub={`${profile.full_name} — ${ROLE_LABELS[profile.role]}`} />
      <Panel className="max-w-md p-5">
        <h2 className="mb-3 font-semibold text-ink">تغيير كلمة المرور</h2>
        <PasswordForm />
      </Panel>
    </>
  );
}
