import Link from 'next/link';
import type { WorkCounts } from '@/lib/engine/counts';
import { fmtNum } from '@/lib/format';

/**
 * عدادان منفصلان دائمًا: المشاريع والأنشطة، والمهام التنفيذية.
 * لا يُجمعان في رقم واحد. الروابط اختيارية للانتقال إلى القائمة المفلترة.
 */
export function WorkCountsBlocks({ counts, hrefWorks, hrefTasks, compact }: { counts: WorkCounts; hrefWorks?: (state: string) => string; hrefTasks?: (state: string) => string; compact?: boolean }) {
  const w = counts.works;
  const t = counts.tasks;
  return (
    <div className={compact ? 'grid gap-3' : 'grid gap-4 md:grid-cols-2'}>
      <Block
        title="المشاريع والأنشطة"
        total={w.total}
        sub={`${fmtNum(w.projects)} مشروع · ${fmtNum(w.activities)} نشاط`}
        rows={[
          ['مكتملة', w.completed, 'var(--done)', 'completed'],
          ['جارية', w.inProgress, 'var(--teal)', 'in_progress'],
          ['متأخرة', w.late, 'var(--orange)', 'late'],
          ['لم تبدأ', w.notStarted, 'var(--nodata)', 'not_started'],
        ]}
        href={hrefWorks}
      />
      <Block
        title="المهام التنفيذية"
        total={t.total}
        sub="داخل المشاريع والأنشطة — كل مهمة تُعد مرة واحدة"
        rows={[
          ['مكتملة', t.completed, 'var(--done)', 'completed'],
          ['جارية', t.inProgress, 'var(--teal)', 'in_progress'],
          ['متأخرة', t.late, 'var(--orange)', 'late'],
          ['لم تبدأ', t.notStarted, 'var(--nodata)', 'not_started'],
        ]}
        href={hrefTasks}
      />
    </div>
  );
}

function Block({ title, total, sub, rows, href }: { title: string; total: number; sub: string; rows: [string, number, string, string][]; href?: (s: string) => string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="num text-3xl font-bold text-ink">{fmtNum(total)}</p>
      </div>
      <p className="text-xs text-muted">{sub}</p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {rows.map(([l, n, c]) => (n ? <div key={l} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: c }} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([l, n, c, k]) => (
          <li key={l} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              {l}
            </span>
            {href ? (
              <Link href={href(k)} className="num font-semibold text-ink hover:text-teal">
                {n}
              </Link>
            ) : (
              <span className="num font-semibold text-ink">{n}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
