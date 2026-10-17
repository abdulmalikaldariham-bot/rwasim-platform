import Link from 'next/link';
import type { ActivityRow } from '@/lib/data/plans';
import { ACTIVITY_STATE } from '@/lib/labels';
import { KIND_LABELS } from '@/lib/engine/weights';
import { fmtDate, fmtPct, relDays } from '@/lib/format';
import { Pill, ProgressBar, stateTone } from './ui';

/** بطاقة النشاط الذكية */
export function ActivityCard({ a, dept, href, showWeight }: { a: ActivityRow; dept: string; href: string; showWeight?: boolean }) {
  const tone = stateTone(a.eval.state);
  const owners = [...new Set(a.steps.map((s) => s.assigneeName ?? s.responsible_text).filter(Boolean))];
  const last = a.steps.map((s) => s.last_update_at).filter(Boolean).sort().at(-1) ?? null;
  const remaining = a.eval.stepsTotal - a.eval.stepsCompleted;
  return (
    <Link href={href} className="group flex flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-teal focus-visible:border-teal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug text-ink group-hover:text-teal">{a.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {dept} — {KIND_LABELS[a.kind]}
            {showWeight ? ` — الوزن ${fmtPct(a.weight)}` : ''}
          </p>
        </div>
        <Pill tone={tone}>{ACTIVITY_STATE[a.eval.state]}</Pill>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ProgressBar value={a.eval.progress} planned={a.eval.planned} tone={tone === 'nodata' ? 'teal' : tone} label={`إنجاز ${a.title}`} />
        <span className="num w-14 shrink-0 text-left text-lg font-bold text-ink">{fmtPct(a.eval.progress)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted">الخطوات</dt>
        <dd className="text-left">
          <span className="num font-semibold text-done">{a.eval.stepsCompleted}</span> مكتملة، <span className="num">{remaining}</span> متبقية
          {a.eval.lateSteps > 0 && <span className="text-late"> ({a.eval.lateSteps} متأخرة)</span>}
        </dd>
        <dt className="text-muted">الموعد</dt>
        <dd className="text-left">{fmtDate(a.eval.dueDate)}</dd>
        <dt className="text-muted">المسؤول</dt>
        <dd className="truncate text-left" title={owners.join('، ')}>
          {owners.slice(0, 2).join('، ') || '—'}
          {owners.length > 2 ? ` +${owners.length - 2}` : ''}
        </dd>
      </dl>
      <p className="mt-auto pt-3 text-xs text-muted">آخر تحديث: {relDays(last)}</p>
    </Link>
  );
}
