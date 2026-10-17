import { Logo } from '@/components/brand';
import { ForgotForm } from './form';

export const metadata = { title: 'استعادة كلمة المرور' };

export default function ForgotPassword() {
  return (
    <main className="hero grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Logo light className="mx-auto mb-8 w-40" />
        <div className="card p-7 text-text">
          <h1 className="text-2xl font-bold text-ink">استعادة كلمة المرور</h1>
          <p className="mt-1 mb-6 text-sm text-muted">أدخل بريدك المسجل وسنرسل لك رابطًا لتعيين كلمة مرور جديدة. إن لم تصلك الرسالة فاطلب من مسؤول النظام رابط تعيين.</p>
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
