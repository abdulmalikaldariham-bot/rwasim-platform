import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { codeCookieName, fetchShare } from '@/lib/share/fetch';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

/** تحديث بيانات لوحة العرض (يستدعيه المتصفح دوريًا). يعيد أرقامًا معتمدة فقط */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const jar = await cookies();
  const code = jar.get(codeCookieName(token))?.value ?? null;
  const y = Number(req.nextUrl.searchParams.get('y')) || null;
  const q = Number(req.nextUrl.searchParams.get('q')) || null;
  const view = await fetchShare(token, code, y, q && q >= 1 && q <= 4 ? q : null);
  const status = view.ok ? 200 : view.reason === 'error' ? 502 : view.reason === 'invalid' || view.reason === 'expired' ? 410 : 401;
  // لا تعاد أسماء الروابط غير الصالحة
  const body = view.ok ? view : { ok: false, reason: view.reason };
  return NextResponse.json(body, { status, headers: HEADERS });
}
