import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * يستقبل روابط التفعيل والاستعادة:
 *  - token_hash + type (روابط المسؤول أو قالب بريد مخصص)
 *  - code (تدفق PKCE الافتراضي لـ resetPasswordForEmail)
 * ثم ينقل المستخدم لتعيين كلمة مروره.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const nextRaw = url.searchParams.get('next') ?? '/auth/set-password';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/auth/set-password';
  const sb = await createClient();
  let ok = false;
  if (tokenHash && type && ['invite', 'recovery', 'signup', 'email', 'magiclink'].includes(type)) {
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  const dest = new URL(ok ? next : '/login?link=expired', url.origin);
  const res = NextResponse.redirect(dest, { status: 303 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
