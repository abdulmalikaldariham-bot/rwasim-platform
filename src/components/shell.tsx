'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  ChartColumn,
  ClipboardList,
  FileText,
  FolderKanban,
  Gauge,
  LayoutGrid,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
  Users,
  X,
  ScrollText,
} from 'lucide-react';
import type { Role } from '@/lib/auth';
import { Wordmark } from './brand';
import { cn } from '@/lib/format';

type Item = { href: string; label: string; icon: typeof Gauge };

const NAV: Record<Role, Item[]> = {
  executive_director: [
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
    { href: '/executive', label: 'مركز المتابعة التنفيذية', icon: Target },
    { href: '/activities', label: 'متابعة الأنشطة', icon: LayoutGrid },
    { href: '/workspace', label: 'مساحات عمل الإدارات', icon: ListChecks },
    { href: '/plans', label: 'الخطط التشغيلية', icon: FolderKanban },
    { href: '/executive-plan', label: 'الخطة التنفيذية', icon: ChartColumn },
    { href: '/reports', label: 'التقارير', icon: FileText },
    { href: '/settings', label: 'الإعدادات', icon: Settings },
  ],
  dept_manager: [
    { href: '/workspace', label: 'مساحة عمل الإدارة', icon: ListChecks },
    { href: '/my-tasks', label: 'مهامي', icon: ClipboardList },
    { href: '/activities', label: 'متابعة الأنشطة', icon: LayoutGrid },
    { href: '/plans', label: 'خطط الإدارة', icon: FolderKanban },
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
    { href: '/executive-plan', label: 'الخطة التنفيذية', icon: ChartColumn },
    { href: '/reports', label: 'التقارير', icon: FileText },
  ],
  employee: [
    { href: '/my-tasks', label: 'مهامي', icon: ClipboardList },
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
  ],
  board_member: [
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
    { href: '/activities', label: 'الأنشطة', icon: LayoutGrid },
    { href: '/executive-plan', label: 'الخطة التنفيذية', icon: ChartColumn },
    { href: '/reports', label: 'التقارير المعتمدة', icon: FileText },
  ],
  system_admin: [
    { href: '/settings/users', label: 'المستخدمون', icon: Users },
    { href: '/settings', label: 'الإعدادات', icon: Settings },
    { href: '/settings/audit', label: 'سجل التغييرات', icon: ScrollText },
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
  ],
};

function ThemeToggle() {
  // الأيقونة والنص يتبدلان بالـ CSS حسب data-theme دون حالة في React
  const flip = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('theme', t);
    } catch {}
  };
  return (
    <button onClick={flip} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-nav-text hover:bg-white/5" aria-label="تبديل الوضع الفاتح والداكن">
      <Moon size={16} className="dark:hidden" />
      <Sun size={16} className="hidden dark:block" />
      <span className="dark:hidden">الوضع الداكن</span>
      <span className="hidden dark:inline">الوضع الفاتح</span>
    </button>
  );
}

export function Shell({
  role,
  user,
  badges,
  children,
}: {
  role: Role;
  user: { name: string; roleLabel: string; dept: string | null };
  badges: Record<string, number>;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV[role];
  const active = (href: string) => {
    const best = items.filter((i) => path === i.href || path.startsWith(i.href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
    return best?.href === href;
  };

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 pt-7 pb-6 mb-4">
        <Link href="/" className="block">
          <Wordmark />
        </Link>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {items.map((it) => {
          const Icon = it.icon;
          const on = active(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                onClick={() => setOpen(false)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.93rem] transition-colors',
                  on ? 'bg-white/10 font-semibold text-white' : 'text-nav-text hover:bg-white/5 hover:text-white',
                )}
              >
                {on && <span className="absolute inset-y-2 right-0 w-1 rounded-full bg-orange" aria-hidden />}
                <Icon size={18} strokeWidth={1.8} />
                <span className="flex-1">{it.label}</span>
                {badges[it.href] ? (
                  <span className="num rounded-full bg-orange px-1.5 text-xs font-bold text-[#2b1700]">{badges[it.href]}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 px-3 py-4">
        <Link href="/account" className="block rounded-lg px-3 pb-3 hover:bg-white/5">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-nav-text">
            {user.roleLabel}
            {user.dept ? ` — ${user.dept}` : ''}
          </p>
        </Link>
        <ThemeToggle />
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-nav-text hover:bg-white/5">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh overflow-y-auto bg-nav lg:block">{nav}</aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-nav px-4 py-3 lg:hidden">
        <Wordmark compact />
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-white" aria-label="القائمة">
          <Menu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-72 overflow-y-auto bg-nav">
            <button onClick={() => setOpen(false)} className="absolute top-5 left-4 p-1 text-white" aria-label="إغلاق">
              <X />
            </button>
            {nav}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
