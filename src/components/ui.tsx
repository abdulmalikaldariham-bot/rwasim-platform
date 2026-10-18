import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn, fmtPct } from '@/lib/format';

// ---------- أزرار ----------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-teal text-white hover:brightness-110 dark:text-[#04141b]',
  secondary: 'bg-surface text-text border border-line hover:bg-sunken',
  ghost: 'text-teal hover:bg-teal-soft',
  danger: 'bg-stalled text-white hover:brightness-110',
  accent: 'bg-orange text-[#2b1700] hover:brightness-105',
};
const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 h-10 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

export function Button({ variant = 'primary', className, ...p }: ComponentProps<'button'> & { variant?: BtnVariant }) {
  return <button className={cn(btnBase, btn[variant], className)} {...p} />;
}
export function ButtonLink({ variant = 'primary', className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cn(btnBase, btn[variant], className)} {...p} />;
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
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-teal hover:underline">
            <span aria-hidden>›</span> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold leading-tight text-ink sm:text-[1.85rem]">{title}</h1>
        <span className="accent-dash mt-2" aria-hidden />
        {sub && <p className="mt-1 max-w-3xl text-[0.95rem] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
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
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
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
      return 'done';
    case 'in_progress':
    case 'on_track':
    case 'submitted':
      return 'teal';
    case 'late':
    case 'at_risk':
    case 'stale':
    case 'returned':
    case 'not_updated':
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

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <svg width="44" height="22" viewBox="0 0 44 22" aria-hidden className="mb-1">
        <path d="M2 18 C 12 4, 22 4, 30 12 S 40 18, 42 6" fill="none" stroke="var(--orange)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="text-base font-semibold text-ink">{title}</p>
      {body && <div className="max-w-md text-sm text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'teal', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <div className={cn('rounded-xl border-s-4 px-4 py-3 text-sm', tones[tone])} style={{ borderInlineStartColor: toneColor[tone] }}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div className="text-text/90">{children}</div>
    </div>
  );
}

// ---------- النماذج ----------
const field = 'w-full card px-3 h-10 text-sm text-text placeholder:text-muted/70 focus:border-teal focus:outline-none';
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
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-text">
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
      <span className="accent-dash mt-1.5" aria-hidden />
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
