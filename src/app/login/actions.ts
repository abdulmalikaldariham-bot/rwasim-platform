'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { homeFor, type Role } from '@/lib/auth';

export async function signIn(_: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '');
  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: 'البريد أو كلمة المرور غير صحيحة.' };
  const { data: p } = await sb.from('profiles').select('role,is_active').eq('id', data.user.id).single();
  if (!p?.is_active) {
    await sb.auth.signOut();
    return { error: 'هذا الحساب معطّل. تواصل مع مسؤول النظام.' };
  }
  redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(p.role as Role));
}
