import { NextResponse } from 'next/server';
import { loadDisplay } from '@/lib/display/build';

export const dynamic = 'force-dynamic';

/** تحديث لوحة العرض الخارجية (يستدعيه المتصفح دوريًا). لا يتطلب جلسة دخول. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let body: { code?: string; year?: number; quarter?: number } = {};
  try {
    body = await req.json();
  } catch {}
  const code = typeof body.code === 'string' ? body.code.slice(0, 64) : null;
  const year = Number.isInteger(body.year) ? body.year! : null;
  const quarter = Number.isInteger(body.quarter) ? body.quarter! : null;
  const result = await loadDisplay(token, { code, year, quarter });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
