import type { Metadata, Viewport } from 'next';
import { loadDisplay } from '@/lib/display/build';
import { DisplayBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'لوحة الأداء المؤسسي', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const viewport: Viewport = { themeColor: '#0d3a4d' };

/** لوحة العرض الخارجية — لا تتطلب دخولًا، وتتحقق من الرابط في قاعدة البيانات */
export default async function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const initial = await loadDisplay(token);
  return <DisplayBoard token={token} initial={initial} />;
}
