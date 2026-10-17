import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-ink">الصفحة غير موجودة</h1>
        <p className="mt-2 text-muted">قد تكون الصفحة حُذفت أو لا تملك صلاحية الاطلاع عليها.</p>
        <Link href="/" className="mt-6 inline-block text-teal underline">
          العودة للرئيسية
        </Link>
      </div>
    </main>
  );
}
