'use server';
import { cookies } from 'next/headers';
import { checkShare, codeCookieName, TOKEN_RE } from '@/lib/share/fetch';

/** التحقق من رمز الوصول وحفظه في ملف تعريف ارتباط httpOnly لهذا الرابط فقط */
export async function unlockShare(token: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'الرابط غير صالح' };
  const c = String(code ?? '').trim();
  if (!c) return { ok: false, error: 'أدخل رمز الوصول' };
  if (c.length > 64) return { ok: false, error: 'رمز الوصول غير صحيح' };
  const r = await checkShare(token, c);
  if (!r.ok) {
    const msg: Record<string, string> = {
      code_invalid: 'رمز الوصول غير صحيح',
      locked: 'تجاوزت عدد المحاولات المسموح. حاول بعد 15 دقيقة',
      expired: 'انتهت صلاحية هذا الرابط',
      invalid: 'هذا الرابط غير متاح',
    };
    return { ok: false, error: msg[r.reason ?? ''] ?? 'تعذر التحقق الآن، حاول مرة أخرى' };
  }
  const jar = await cookies();
  jar.set(codeCookieName(token), c, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
}
