import Link from 'next/link';
import { Logo } from '@/components/brand';
import { ForgotForm } from './form';

export const metadata = { title: 'استعادة كلمة المرور' };

export default function ForgotPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo onSurface className="mx-auto mb-8 w-40" />
        <div className="card p-6 shadow-[var(--shadow)]">
          <h1 className="text-xl font-bold text-ink">نسيت كلمة المرور؟</h1>
          <p className="mt-1 mb-5 text-sm text-muted">أدخل بريدك المسجل، وسنرسل إليه رابطًا لتعيين كلمة مرور جديدة.</p>
          <ForgotForm />
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-teal hover:underline">
            › العودة لتسجيل الدخول
          </Link>
        </p>
      </div>
    </main>
  );
}
