'use client';
import { Button } from '@/components/ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="text-xl font-bold text-ink">تعذر عرض الصفحة</h1>
      <p className="mt-2 text-sm text-muted">{error.message?.length < 200 ? error.message : 'حدث خطأ غير متوقع.'}</p>
      {error.digest && <p className="num mt-1 text-xs text-muted">رمز الخطأ: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        إعادة المحاولة
      </Button>
    </div>
  );
}
