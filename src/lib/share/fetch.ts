import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildShareView, type ShareFailure, type ShareView } from './view';

/** الرمز: 43 حرفًا base64url (256 بت). نقبل 32–128 للتوافق */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** اسم ملف تعريف الارتباط الذي يحفظ رمز الوصول لهذا الرابط فقط (لا يكشف الرمز نفسه) */
export function codeCookieName(token: string) {
  return `rs_share_${createHash('sha256').update(token).digest('hex').slice(0, 20)}`;
}

/** عميل الزائر: مفتاح anon دون أي جلسة — لا يرى إلا ما تتيحه دالتا share_check و share_dashboard */
function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function checkShare(token: string, code: string | null): Promise<{ ok: boolean; reason?: string; name?: string }> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: 'invalid' };
  const { data, error } = await anonClient().rpc('share_check', { p_token: token, p_code: code });
  if (error) return { ok: false, reason: 'error' };
  return data as { ok: boolean; reason?: string; name?: string };
}

export async function fetchShare(token: string, code: string | null, year?: number | null, quarter?: number | null): Promise<ShareView | ShareFailure> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: 'invalid' };
  const { data, error } = await anonClient().rpc('share_dashboard', {
    p_token: token,
    p_code: code,
    p_year: year ?? null,
    p_quarter: quarter ?? null,
  });
  if (error) return { ok: false, reason: 'error' };
  return buildShareView(data);
}
