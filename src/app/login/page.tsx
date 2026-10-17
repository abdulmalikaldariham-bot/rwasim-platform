import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/auth';
import { Wordmark } from '@/components/brand';
import { LoginForm } from './login-form';

export const metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; inactive?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (s && s.profile.is_active) redirect(homeFor(s.profile.role));
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Wordmark light={false} />
          </div>
          <h1 className="text-2xl font-bold text-ink">تسجيل الدخول</h1>
          <p className="mt-1 mb-8 text-sm text-muted">استخدم البريد الذي أضافه لك مسؤول النظام.</p>
          {sp.inactive && <p className="mb-4 rounded-lg bg-stalled-soft px-3 py-2 text-sm text-stalled">هذا الحساب معطّل. تواصل مع مسؤول النظام.</p>}
          <LoginForm next={sp.next} />
        </div>
      </section>
      <aside className="relative hidden overflow-hidden bg-nav lg:block" aria-hidden>
        <div className="absolute inset-0 flex flex-col justify-between p-12">
          <Wordmark />
          <div className="space-y-3">
            {[92, 74, 86, 63, 80].map((w, i) => (
              <div key={i} className="h-10 overflow-hidden rounded-md bg-white/5">
                <div className="settle h-full" style={{ width: `${w}%`, marginInlineStart: 0, background: ['#f09223', '#326e7c', '#1d5160', '#326e7c', '#2a6070'][i], opacity: i === 0 ? 0.9 : 1, animationDelay: `${i * 90}ms` }} />
              </div>
            ))}
            <p className="pt-4 text-sm text-nav-text">الخطط، والإنجاز، والمؤشرات — في مكان واحد.</p>
          </div>
        </div>
      </aside>
    </main>
  );
}
