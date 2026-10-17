'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { Logo } from '@/components/brand';
import { unlockShare } from './actions';

export function CodeGate({ token, name, locked }: { token: string; name?: string; locked?: boolean }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(locked ? 'تجاوزت عدد المحاولات المسموح. حاول بعد 15 دقيقة' : null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <main data-theme="dark" className="grid min-h-dvh place-items-center bg-paper p-6 text-text">
      <form
        className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await unlockShare(token, code);
            if (r.ok) router.refresh();
            else setError(r.error ?? 'تعذر التحقق');
          });
        }}
      >
        <Logo light className="mx-auto mb-6 w-36" />
        <div className="mb-5 text-center">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-orange-soft text-orange">
            <LockKeyhole size={20} />
          </span>
          <h1 className="text-lg font-bold text-ink">{name ?? 'لوحة الأداء'}</h1>
          <p className="mt-1 text-sm text-muted">هذه اللوحة محمية برمز وصول.</p>
        </div>
        <label htmlFor="code" className="mb-1 block text-sm text-muted">
          رمز الوصول
        </label>
        <input
          id="code"
          type="password"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-xl border border-line bg-sunken px-4 py-3 text-center text-lg tracking-widest text-text outline-none focus:border-teal"
          dir="ltr"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-stalled">
            {error}
          </p>
        )}
        <button disabled={pending || !code.trim()} className="mt-5 w-full rounded-xl bg-orange py-3 font-semibold text-[#04141b] transition hover:brightness-105 disabled:opacity-50">
          {pending ? 'جارٍ التحقق…' : 'عرض اللوحة'}
        </button>
      </form>
    </main>
  );
}
