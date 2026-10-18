import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/auth';
import { Logo } from '@/components/brand';
import { SetPasswordForm } from './form';

export const metadata = { title: 'تعيين كلمة المرور' };
export const dynamic = 'force-dynamic';

export default async function SetPasswordPage() {
  const s = await getSession();
  if (!s) redirect('/login?link=expired');
  if (!s.profile.is_active) redirect('/login?inactive=1');
  const forced = !!(s.profile as { must_change_password?: boolean }).must_change_password;
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo onSurface className="mx-auto mb-8 w-40" />
        <div className="card p-6 shadow-[var(--shadow)]">
          <h1 className="text-xl font-bold text-ink">{forced ? 'عيّن كلمة مرورك' : 'كلمة مرور جديدة'}</h1>
          <p className="mt-1 mb-5 text-sm text-muted">
            مرحبًا {s.profile.full_name}. {forced ? 'لأمان حسابك، اختر كلمة مرور خاصة بك قبل المتابعة.' : 'اختر كلمة مرور جديدة لحسابك.'}
          </p>
          <SetPasswordForm home={homeFor(s.profile.role)} email={s.profile.email ?? ''} />
        </div>
        <form action="/auth/signout" method="post" className="mt-4 text-center">
          <button className="text-sm text-muted hover:text-text">تسجيل الخروج</button>
        </form>
      </div>
    </main>
  );
}
