import Link from 'next/link';
import { CalendarRange, Paperclip, Star, Target } from 'lucide-react';
import { AvatarStack, Pill, stateTone } from '../ui';
import { STEP_STATUS, TIMING } from '@/lib/labels';
import { fmtDate, fmtPct } from '@/lib/format';
import { TaskUpdater, type UpdatableStep } from './task-updater';
import type { ActivityKind, StepStatus, StepTiming } from '@/lib/engine/types';

export interface TaskCardData extends UpdatableStep {
  activityTitle: string;
  activityId: string;
  activityKind?: ActivityKind;
  deptName?: string;
  responsible: string | null;
  assigneeName: string | null;
  assignees: { name: string; isLead: boolean; status: StepStatus }[];
  isCore?: boolean;
  dueDate: string | null;
  startDate?: string | null;
  timing?: StepTiming;
  isLate: boolean;
  daysLate: number;
  progress: number;
  evidenceCount: number;
  canUpdate: boolean;
  departmentId?: string;
  weekSpan?: string;
}

const STRIPE: Record<string, string> = { done: 'var(--done)', late: 'var(--orange)', stalled: 'var(--stalled)', teal: 'var(--teal)', nodata: 'var(--line)' };

/** بطاقة المهمة: الاسم، المشروع، الإدارة، الفترة، المخرج المطلوب، الحالتان، المكلفون */
export function TaskCard({ t, showDept = false, from }: { t: TaskCardData; showDept?: boolean; from?: string }) {
  const effStatus = (t.mode === 'individual' && t.myStatus ? t.myStatus : t.status) as StepStatus;
  const tone = t.status === 'completed' ? 'done' : t.isLate ? 'late' : stateTone(t.status);
  return (
    <article className="card card-hover relative flex flex-col overflow-hidden p-4">
      <span className="absolute inset-y-4 right-0 w-1 rounded-l-full" style={{ background: STRIPE[tone] ?? 'var(--line)' }} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-0.5 truncate text-xs text-muted">
            {t.activityKind === 'project' ? 'مشروع: ' : 'نشاط: '}
            <Link href={`/activities/${t.activityId}`} className="text-teal hover:underline">
              {t.activityTitle}
            </Link>
            {showDept && t.deptName ? ` · ${t.deptName}` : ''}
          </p>
          <h3 className="font-bold leading-snug text-ink">
            <Link href={`/tasks/${t.id}${from ? `?from=${from}` : ''}`} className="after:absolute after:inset-0 hover:text-teal">
              {t.title}
            </Link>
            {t.isCore && <Star size={13} className="ms-1.5 inline -translate-y-0.5 fill-orange text-orange" aria-label="المهمة الجوهرية" />}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Pill tone={stateTone(effStatus)}>{t.mode === 'individual' && t.myStatus ? `إنجازي: ${STEP_STATUS[effStatus]}` : STEP_STATUS[t.status as StepStatus]}</Pill>
          {t.timing && t.timing !== 'done' && (
            <Pill tone={t.timing === 'overdue' ? 'late' : t.timing === 'in_window' ? 'teal' : 'nodata'}>
              {t.timing === 'overdue' ? `متأخرة ${t.daysLate} يومًا` : TIMING[t.timing]}
            </Pill>
          )}
        </div>
      </div>

      {t.output && (
        <div className="mt-3 rounded-xl bg-sunken/70 px-3 py-2 text-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-late">
            <Target size={13} /> المخرج المطلوب
          </p>
          <p className="line-clamp-2 text-text">{t.output}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <CalendarRange size={14} />
          {t.dueDate ? (
            <span>
              {t.startDate && t.startDate !== t.dueDate ? `${fmtDate(t.startDate)} – ` : ''}
              <span className="font-semibold text-text">{fmtDate(t.dueDate)}</span>
            </span>
          ) : (
            <span className="text-late">بلا تاريخ — للمراجعة</span>
          )}
        </span>
        {t.substeps.length > 0 && <span className="num">{fmtPct(t.progress)}</span>}
        {t.mode === 'individual' && t.status !== 'completed' && (
          <span>
            {t.assignees.filter((a) => a.status === 'completed').length}/{t.assignees.length} أنجزوا
          </span>
        )}
        {t.evidenceCount > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={12} /> {t.evidenceCount}
          </span>
        )}
      </div>

      <div className="relative z-10 mt-auto flex items-center justify-between gap-2 pt-3">
        {t.assignees.length ? (
          <AvatarStack names={t.assignees.map((a) => a.name)} />
        ) : (
          <span className="text-xs text-muted">{t.responsible ? `المسؤول: ${t.responsible}` : 'غير مسندة'}</span>
        )}
        {t.canUpdate && <TaskUpdater step={t} departmentId={t.departmentId} compact />}
      </div>
    </article>
  );
}
