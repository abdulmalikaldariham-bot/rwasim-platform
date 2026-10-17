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
  MonitorPlay,
  Settings,
  Sun,
  Target,
  Users,
  X,
  ScrollText,
} from 'lucide-react';
import type { Role } from '@/lib/auth';
import { Wordmark } from './brand';
import { Avatar } from './ui';
import { cn } from '@/lib/format';

type Item = { href: string; label: string; icon: typeof Gauge; group?: string };

const NAV: Record<Role, Item[]> = {
  executive_director: [
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
    { href: '/my-tasks', label: 'مهامي', icon: ClipboardList },
    { href: '/executive', label: 'مركز المتابعة التنفيذية', icon: Target },
    { href: '/activities', label: 'المشاريع والأنشطة', icon: LayoutGrid, group: 'المتابعة' },
    { href: '/workspace', label: 'مساحات عمل الإدارات', icon: ListChecks, group: 'المتابعة' },
    { href: '/plans', label: 'الخطط التشغيلية', icon: FolderKanban, group: 'التخطيط' },
    { href: '/executive-plan', label: 'الخطة التنفيذية', icon: ChartColumn, group: 'التخطيط' },
    { href: '/reports', label: 'التقارير', icon: FileText, group: 'التخطيط' },
    { href: '/share', label: 'روابط عرض الأداء', icon: MonitorPlay, group: 'الإدارة' },
    { href: '/settings', label: 'الإعدادات', icon: Settings, group: 'الإدارة' },
  ],
  dept_manager: [
    { href: '/workspace', label: 'مساحة عمل الإدارة', icon: ListChecks },
    { href: '/my-tasks', label: 'مهامي', icon: ClipboardList },
    { href: '/activities', label: 'المشاريع والأنشطة', icon: LayoutGrid },
    { href: '/plans', label: 'خطط الإدارة', icon: FolderKanban, group: 'التخطيط' },
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge, group: 'التخطيط' },
    { href: '/executive-plan', label: 'الخطة التنفيذية', icon: ChartColumn, group: 'التخطيط' },
    { href: '/reports', label: 'التقارير', icon: FileText, group: 'التخطيط' },
  ],
  employee: [
    { href: '/my-tasks', label: 'مهامي', icon: ClipboardList },
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
  ],
  board_member: [
    { href: '/dashboard', label: 'لوحة الأداء', icon: Gauge },
    { href: '/activities', label: 'المشاريع والأنشطة', icon: LayoutGrid },
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
    <button onClick={flip} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-nav-text hover:bg-white/5 hover:text-white" aria-label="تبديل الوضع الفاتح والداكن">
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

  const groupStarts = new Set(items.filter((it, i) => it.group && it.group !== items[i - 1]?.group).map((it) => it.href));
  const nav = (
    <nav className="glow flex h-full flex-col" style={{ background: 'linear-gradient(180deg, var(--nav) 0%, var(--nav-deep) 100%)' }}>
      <div className="mx-4 mb-3 border-b border-white/10 px-1 pt-7 pb-6">
        <Link href="/" className="block">
          <Wordmark />
        </Link>
      </div>
      <ul className="flex-1 space-y-0.5 px-3 pb-4">
        {items.map((it) => {
          const Icon = it.icon;
          const on = active(it.href);
          const showGroup = groupStarts.has(it.href);
          return (
            <li key={it.href}>
              {showGroup && <p className="mt-4 mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-nav-text/70">{it.group}</p>}
              <Link
                href={it.href}
                onClick={() => setOpen(false)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.93rem] transition-colors',
                  on ? 'bg-white/[0.09] font-semibold text-white shadow-[inset_0_0_0_1px_#ffffff14]' : 'text-nav-text hover:bg-white/5 hover:text-white',
                )}
              >
                {on && <span className="absolute inset-y-2.5 right-0 w-1 rounded-full bg-orange" aria-hidden />}
                <Icon size={18} strokeWidth={1.8} className={on ? 'text-orange' : undefined} />
                <span className="flex-1">{it.label}</span>
                {badges[it.href] ? <span className="num rounded-full bg-orange px-1.5 text-xs font-bold text-[#2b1700]">{badges[it.href]}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 px-3 py-4">
        <Link href="/account" className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5">
          <Avatar name={user.name || '؟'} size={34} className="ring-white/20" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
            <span className="block truncate text-xs text-nav-text">
              {user.roleLabel}
              {user.dept ? ` — ${user.dept}` : ''}
            </span>
          </span>
        </Link>
        <ThemeToggle />
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-nav-text hover:bg-white/5 hover:text-white">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh overflow-y-auto lg:block">{nav}</aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 lg:hidden" style={{ background: 'var(--nav)' }}>
        <Wordmark compact />
        <button onClick={() => setOpen(true)} className="rounded-full p-2 text-white hover:bg-white/10" aria-label="القائمة">
          <Menu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[18rem] max-w-[85vw] overflow-y-auto">
            <button onClick={() => setOpen(false)} className="absolute top-5 left-4 z-10 rounded-full p-1 text-white hover:bg-white/10" aria-label="إغلاق">
              <X />
            </button>
            {nav}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
