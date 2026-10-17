import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn, fmtPct } from '@/lib/format';

// ---------- أزرار ----------
// أزرار على هيئة كبسولة كما في موقع رواسم؛ الأساسي بلون الحبر، والإجرائي بالبرتقالي.
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-ink text-white shadow-[0_8px_20px_-10px_var(--ink)] hover:bg-teal dark:bg-teal dark:text-[#041720] dark:hover:brightness-110',
  secondary: 'bg-surface text-text border border-line hover:border-teal/50 hover:bg-sunken',
  ghost: 'text-teal hover:bg-teal-soft',
  danger: 'bg-stalled text-white hover:brightness-110',
  accent: 'bg-orange text-[#2b1700] shadow-[0_8px_20px_-10px_var(--orange)] hover:brightness-105',
};
const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 h-10 text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap active:scale-[0.98]';

export function Button({ variant = 'primary', className, ...p }: ComponentProps<'button'> & { variant?: BtnVariant }) {
  return <button className={cn(btnBase, btn[variant], className)} {...p} />;
}
export function ButtonLink({ variant = 'primary', className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cn(btnBase, btn[variant], className)} {...p} />;
}

/** زر الدعوة للإجراء بدائرة برتقالية وسهم (نمط أزرار rwasim.sa) */
export function CtaLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 ps-5 pe-1.5 text-sm font-semibold text-ink transition hover:border-orange/60', className)}>
      {children}
      <span className="grid h-8 w-8 place-items-center rounded-full bg-orange text-[#2b1700] transition group-hover:-translate-x-0.5">
        <ChevronLeft size={16} />
      </span>
    </Link>
  );
}

// ---------- لوحات ----------
export function Panel({ className, children, ...p }: ComponentProps<'section'>) {
  return (
    <section className={cn('card', className)} {...p}>
      {children}
    </section>
  );
}
export function PanelHead({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[1.05rem] font-bold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, sub, actions, back, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; eyebrow?: ReactNode }) {
  return (
    <header className="rise mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-sm text-teal shadow-card hover:text-ink">
            <span aria-hidden>→</span> {back.label}
          </Link>
        )}
        {eyebrow && <p className="mb-1 text-sm font-medium text-late">{eyebrow}</p>}
        <h1 className="text-[1.65rem] font-bold leading-tight text-ink sm:text-[2rem]">{title}</h1>
        {sub && <p className="mt-1.5 max-w-3xl text-[0.95rem] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** تبويبات على شكل كبسولة (روابط) */
export function Tabs({ items, active, className }: { items: { key: string; label: ReactNode; href: string; count?: number; tone?: Tone }[]; active: string; className?: string }) {
  return (
    <nav className={cn('mb-6 flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 shadow-card sm:w-fit', className)} aria-label="التبويبات">
      {items.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn('flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm transition', on ? 'bg-ink font-semibold text-white dark:bg-teal dark:text-[#041720]' : 'text-muted hover:text-text')}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('num rounded-full px-1.5 text-xs', on ? 'bg-white/20' : t.tone === 'late' && t.count > 0 ? 'bg-orange-soft text-late' : 'bg-sunken')}>{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- الحالة ----------
export type Tone = 'done' | 'teal' | 'late' | 'stalled' | 'nodata' | 'orange' | 'neutral';
const tones: Record<Tone, string> = {
  done: 'bg-done-soft text-done',
  teal: 'bg-teal-soft text-teal',
  late: 'bg-orange-soft text-late',
  orange: 'bg-orange-soft text-late',
  stalled: 'bg-stalled-soft text-stalled',
  nodata: 'bg-sunken text-muted',
  neutral: 'bg-sunken text-text',
};
export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export const toneColor: Record<Tone, string> = {
  done: 'var(--done)',
  teal: 'var(--teal)',
  late: 'var(--late)',
  orange: 'var(--orange)',
  stalled: 'var(--stalled)',
  nodata: 'var(--nodata)',
  neutral: 'var(--muted)',
};

export function stateTone(state: string): Tone {
  switch (state) {
    case 'completed':
    case 'achieved':
    case 'approved':
    case 'ok':
    case 'done':
      return 'done';
    case 'in_progress':
    case 'on_track':
    case 'submitted':
    case 'in_window':
      return 'teal';
    case 'late':
    case 'at_risk':
    case 'stale':
    case 'returned':
    case 'not_updated':
    case 'overdue':
      return 'late';
    case 'stalled':
    case 'off_track':
    case 'on_hold':
      return 'stalled';
    default:
      return 'nodata';
  }
}

export function ProgressBar({ value, tone = 'teal', planned, size = 'md', label }: { value: number | null; tone?: Tone; planned?: number | null; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-sunken', h)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-label={label}
    >
      {value !== null && (
        <div className="settle absolute inset-y-0 right-0 rounded-full" style={{ width: `${Math.min(100, value)}%`, background: toneColor[tone] }} />
      )}
      {planned !== null && planned !== undefined && planned > 0 && (
        <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ right: `calc(${Math.min(100, planned)}% - 1px)` }} title={`المخطط ${fmtPct(planned)}`} />
      )}
    </div>
  );
}

/** حلقة إنجاز دائرية خفيفة */
export function Ring({ value, size = 64, stroke = 7, tone = 'teal', children }: { value: number | null; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={toneColor[tone]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-2 grid h-14 w-14 place-items-center rounded-full bg-teal-soft text-teal">
        {icon ?? (
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
            <path d="M5 20c4-8 9-9 13-6s7 1 9-4" stroke="var(--orange)" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M6 25h20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      {body && <div className="max-w-md text-sm text-muted">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'teal', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <div className={cn('rounded-2xl border-s-4 px-4 py-3 text-sm', tones[tone])} style={{ borderInlineStartColor: toneColor[tone] }}>
      {title && <p className="mb-0.5 font-bold">{title}</p>}
      <div className="text-text/90">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

// ---------- النماذج ----------
const field =
  'w-full rounded-xl border border-line bg-surface px-3 h-10 text-sm text-text placeholder:text-muted/70 transition focus:border-teal focus:ring-2 focus:ring-teal/15 focus:outline-none disabled:bg-sunken disabled:text-muted';
export function Input({ className, ...p }: ComponentProps<'input'>) {
  return <input className={cn(field, className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'h-auto min-h-20 py-2 leading-relaxed', className)} {...p} />;
}
export function Select({ className, children, ...p }: ComponentProps<'select'>) {
  return (
    <select className={cn(field, 'pe-8', className)} {...p}>
      {children}
    </select>
  );
}
export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-text">
      {children}
      {hint && <span className="ms-1 font-normal text-muted">({hint})</span>}
    </label>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-0.5 text-2xl font-bold" style={{ color: tone ? toneColor[tone] : 'var(--ink)', textAlign: 'right' }}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** بطاقة رقم بنمط «أثرنا بالأرقام»: أيقونة، رقم كبير، خط برتقالي قصير، وصف */
export function StatCard({ label, value, sub, icon, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; href?: string }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <span className="text-orange">{icon}</span>}
      </div>
      <p className="num mt-2 text-[1.9rem] leading-none font-bold" style={{ color: tone ? toneColor[tone] : 'var(--ink)', textAlign: 'right' }}>
        {value}
      </p>
      <span className="accent-dash mt-3" />
      {sub && <p className="mt-2 text-xs text-muted">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card card-hover block p-4">
      {inner}
    </Link>
  ) : (
    <div className="card p-4">{inner}</div>
  );
}

/** صورة رمزية بالأحرف الأولى */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      title={name}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-surface', className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${(h % 60) + 175} 38% 36%)` }}
    >
      {initials}
    </span>
  );
}
export function AvatarStack({ names, max = 4, size = 26 }: { names: string[]; max?: number; size?: number }) {
  if (!names.length) return null;
  return (
    <span className="flex items-center -space-x-2 space-x-reverse">
      {names.slice(0, max).map((n, i) => (
        <Avatar key={i} name={n} size={size} />
      ))}
      {names.length > max && (
        <span className="num inline-grid place-items-center rounded-full bg-sunken text-[11px] font-bold text-muted ring-2 ring-surface" style={{ width: size, height: size }}>
          +{names.length - max}
        </span>
      )}
    </span>
  );
}
