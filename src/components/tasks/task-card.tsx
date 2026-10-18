import Link from 'next/link';
import { CalendarDays, Paperclip, Users, Target } from 'lucide-react';
import { Pill, stateTone } from '../ui';
import { STEP_STATUS, TIME_STATE } from '@/lib/labels';
import { fmtDate, fmtPct } from '@/lib/format';
import { QuickComplete } from './quick-complete';
import type { StepStatus, TimeState } from '@/lib/engine/types';

export interface TaskCardData {
  id: string;
  title: string;
  status: StepStatus;
  output: string | null;
  outputAchieved: string | null;
  substeps: { id: string; title: string; weight: number; is_done: boolean }[];
  activityTitle: string;
  activityId: string;
  departmentName?: string;
  responsible: string | null;
  assigneeName: string | null;
  assigneesCount: number;
  startDate: string | null;
  dueDate: string | null;
  datesSource: 'weeks' | 'manual' | 'none';
  timeState: TimeState;
  isLate: boolean;
  daysLate: number;
  progress: number;
  evidenceCount: number;
  canUpdate: boolean;
  quick: boolean;
  individual: boolean;
  myDone?: boolean;
  departmentId?: string;
  weekSpan?: string;
}

const edge: Record<string, string> = { done: 'var(--done)', late: 'var(--late)', stalled: 'var(--stalled)', teal: 'var(--teal)' };

export function TaskCard({ t, from }: { t: TaskCardData; from?: string }) {
  const tone = t.status === 'completed' ? 'done' : t.isLate ? 'late' : stateTone(t.status);
  const href = `/tasks/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  return (
    <article className="group relative flex min-w-0 flex-col card p-4 transition hover:border-teal">
      <span className="absolute inset-y-4 right-0 w-1 rounded-full" style={{ background: edge[tone] ?? 'var(--line)' }} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug text-ink">
            <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none">
              {t.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted">
            {t.activityTitle}
            {t.departmentName ? ` — ${t.departmentName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Pill tone={tone}>{t.isLate && t.status !== 'completed' ? `متأخرة ${t.daysLate} يومًا` : STEP_STATUS[t.status]}</Pill>
          {t.status !== 'completed' && !t.isLate && t.timeState !== 'unscheduled' && <span className="text-[11px] text-muted">{TIME_STATE[t.timeState]}</span>}
        </div>
      </div>

      {t.output && (
        <p className="mt-3 flex gap-1.5 rounded-xl bg-sunken px-3 py-2 text-sm">
          <Target size={15} className="mt-0.5 shrink-0 text-orange" />
          <span>
            <span className="text-muted">المخرج المطلوب: </span>
            {t.output}
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <CalendarDays size={14} />
          {t.startDate ? (
            <>
              {fmtDate(t.startDate)} – {fmtDate(t.dueDate)}
              {t.datesSource === 'weeks' && <span className="text-[11px]">(تقديري)</span>}
            </>
          ) : (
            <span className="text-late">بلا تاريخ</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <Users size={14} />
          {t.assigneeName ?? t.responsible ?? 'غير مسندة'}
        </span>
        {t.evidenceCount > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={13} /> {t.evidenceCount}
          </span>
        )}
        {(t.substeps.length > 0 || t.individual) && t.status !== 'completed' && <span className="num">{fmtPct(t.progress)}</span>}
      </div>

      {t.individual && t.myDone !== undefined && (
        <p className={`mt-2 text-xs ${t.myDone ? 'text-done' : 'text-muted'}`}>مهمة فردية: {t.myDone ? 'سجلت إنجازك' : 'لم تسجل إنجازك بعد'}</p>
      )}

      {t.canUpdate && t.status !== 'completed' && (
        <div className="relative z-10 mt-3 flex justify-end gap-2">
          {t.quick && <QuickComplete id={t.id} />}
          <Link href={href + (href.includes('?') ? '&' : '?') + 'act=1'} className="inline-flex h-8 items-center rounded-xl px-3 text-xs font-semibold text-teal hover:bg-teal-soft">
            تسجيل الإنجاز
          </Link>
        </div>
      )}
    </article>
  );
}
