import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { codeCookieName, fetchShare } from '@/lib/share/fetch';
import { Logo } from '@/components/brand';
import { CodeGate } from './code-gate';
import { ShareScreen } from './screen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'لوحة الأداء',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ y?: string; q?: string; tv?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const jar = await cookies();
  const code = jar.get(codeCookieName(token))?.value ?? null;
  const view = await fetchShare(token, code, Number(sp.y) || null, Number(sp.q) || null);

  if (!view.ok) {
    if (view.reason === 'code_required' || view.reason === 'code_invalid' || view.reason === 'locked') {
      return <CodeGate token={token} name={view.name} locked={view.reason === 'locked'} />;
    }
    const msg =
      view.reason === 'expired'
        ? { t: 'انتهت صلاحية هذا الرابط', b: 'اطلب رابطًا جديدًا من إدارة الجمعية.' }
        : view.reason === 'error'
          ? { t: 'تعذر تحميل اللوحة الآن', b: 'حدّث الصفحة بعد قليل.' }
          : { t: 'هذا الرابط غير متاح', b: 'قد يكون الرابط أُلغي أو أُوقف. تواصل مع إدارة الجمعية.' };
    return (
      <main data-theme="dark" className="grid min-h-dvh place-items-center bg-paper p-6 text-text">
        <div className="max-w-md text-center">
          <Logo light className="mx-auto mb-8 w-44" />
          <h1 className="text-2xl font-bold text-ink">{msg.t}</h1>
          <p className="mt-2 text-muted">{msg.b}</p>
        </div>
      </main>
    );
  }
  return <ShareScreen token={token} initial={view} tvMode={sp.tv === '1'} />;
}
