import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Role = 'executive_director' | 'dept_manager' | 'employee' | 'board_member' | 'system_admin';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  department_id: string | null;
  job_title: string | null;
  is_active: boolean;
  must_change_password?: boolean;
}

export const getSession = cache(async () => {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile) return null;
  return { sb, user: data.user, profile: profile as Profile };
});

export async function requireSession(roles?: Role[]) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.profile.is_active) redirect('/login?inactive=1');
  // كلمة مرور مؤقتة أو حساب جديد: لا وصول قبل تعيين كلمة مرور خاصة
  if (s.profile.must_change_password) redirect('/auth/set-password');
  if (roles && !roles.includes(s.profile.role)) redirect('/?denied=1');
  return s;
}

export function homeFor(role: Role): string {
  switch (role) {
    case 'executive_director':
    case 'board_member':
      return '/dashboard';
    case 'dept_manager':
      return '/workspace';
    case 'employee':
      return '/my-tasks';
    case 'system_admin':
      return '/settings/users';
  }
}
