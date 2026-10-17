import Link from 'next/link';
import { Paperclip, User } from 'lucide-react';
import { Pill, stateTone } from '../ui';
import { STEP_STATUS } from '@/lib/labels';
import { fmtDate, fmtPct } from '@/lib/format';
import { TaskUpdater, type UpdatableStep } from './task-updater';
import type { StepStatus } from '@/lib/engine/types';

export interface TaskCardData extends UpdatableStep {
  activityTitle: string;
  activityId: string;
  responsible: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  isLate: boolean;
  daysLate: number;
  progress: number;
  evidenceCount: number;
  canUpdate: boolean;
  departmentId?: string;
  weekSpan?: string;
}

export function TaskCard({ t }: { t: TaskCardData }) {
  const tone = t.status === 'completed' ? 'done' : t.isLate ? 'late' : stateTone(t.status);
  return (
    <article className="rounded-xl border border-line bg-surface p-4" style={{ borderInlineStartWidth: 4, borderInlineStartColor: `var(--${tone === 'done' ? 'done' : tone === 'late' ? 'late' : tone === 'stalled' ? 'stalled' : tone === 'teal' ? 'teal' : 'line'})` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug text-ink">{t.title}</h3>
          <Link href={`/activities/${t.activityId}`} className="text-sm text-teal hover:underline">
            {t.activityTitle}
          </Link>
        </div>
        <Pill tone={tone}>{t.isLate && t.status !== 'completed' ? `متأخرة ${t.daysLate} يومًا` : STEP_STATUS[t.status as StepStatus]}</Pill>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div className="col-span-2 flex gap-1.5 text-muted sm:col-span-1">
          <dt className="sr-only">المسؤول</dt>
          <User size={14} className="mt-1 shrink-0" />
          <dd className="truncate">{t.assigneeName ?? t.responsible ?? 'غير محدد'}</dd>
        </div>
        <div className="col-span-2 text-muted sm:col-span-1">
          <dt className="inline">الموعد: </dt>
          <dd className="inline text-text">{t.dueDate ? fmtDate(t.dueDate) : 'بلا جدولة'}</dd>
          {t.weekSpan && <span className="text-xs"> ({t.weekSpan})</span>}
        </div>
        {t.output && (
          <div className="col-span-2 text-muted">
            <dt className="inline">المخرج: </dt>
            <dd className="inline text-text">{t.output}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-3 text-xs text-muted">
          {t.substeps.length > 0 && <span className="num">{fmtPct(t.progress)}</span>}
          {t.evidenceCount > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip size={12} /> {t.evidenceCount}
            </span>
          )}
        </span>
        {t.canUpdate && <TaskUpdater step={t} departmentId={t.departmentId} compact />}
      </div>
    </article>
  );
}
