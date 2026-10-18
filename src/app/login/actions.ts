'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { homeFor, type Role } from '@/lib/auth';

export async function signIn(_: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '');
  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: 'البريد أو كلمة المرور غير صحيحة.' };
  const { data: p } = await sb.from('profiles').select('role,is_active,must_change_password').eq('id', data.user.id).single();
  if (!p?.is_active) {
    await sb.auth.signOut();
    return { error: 'هذا الحساب معطّل. تواصل مع مسؤول النظام.' };
  }
  if (p.must_change_password) redirect('/auth/set-password');
  redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(p.role as Role));
}

/** طلب رابط استعادة. الرد موحد دائمًا حتى لا يُكشف وجود البريد */
export async function requestPasswordReset(_: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'أدخل بريدًا صحيحًا' };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const sb = await createClient();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm?next=/auth/set-password` });
  return { sent: true };
}
