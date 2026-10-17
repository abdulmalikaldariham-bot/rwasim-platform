import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/auth';
import { Logo } from '@/components/brand';
import { SetPasswordForm } from './form';

export const metadata = { title: 'تعيين كلمة المرور' };

export default async function SetPassword() {
  const s = await getSession();
  if (!s) redirect('/login?link=invalid');
  if (!s.profile.is_active) redirect('/login?inactive=1');
  return (
    <main className="hero grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Logo light className="mx-auto mb-8 w-40" />
        <div className="card p-7 text-text">
          <h1 className="text-2xl font-bold text-ink">مرحبًا {s.profile.full_name}</h1>
          <p className="mt-1 mb-6 text-sm text-muted">عيّن كلمة مرور خاصة بك للدخول إلى منصة الأداء المؤسسي.</p>
          <SetPasswordForm home={homeFor(s.profile.role)} email={s.profile.email ?? ''} />
        </div>
      </div>
    </main>
  );
}
