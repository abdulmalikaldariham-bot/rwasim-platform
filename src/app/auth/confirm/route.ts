import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * تأكيد روابط الإعداد والاستعادة:
 *  - token_hash + type (روابط الإعداد التي ينشئها المسؤول، أو قالب بريد مخصص)
 *  - code (روابط البريد الافتراضية في Supabase بتدفق PKCE)
 * ثم التوجيه إلى صفحة تعيين كلمة المرور.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/set-password';
  const sb = await createClient();
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  let ok = false;
  if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  const dest = new URL(ok ? safeNext : '/login?link=invalid', req.url);
  return NextResponse.redirect(dest);
}
