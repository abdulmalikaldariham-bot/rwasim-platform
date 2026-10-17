import { evaluateStep } from '../engine/progress';
import type { WeekBoundary } from '../engine/types';
import type { StepRow } from './plans';
import type { TaskCardData } from '@/components/tasks/task-card';
import { MONTHS } from '../labels';

export function weekSpanLabel(weeks: number[], b: WeekBoundary[]): string | undefined {
  if (weeks.length <= 1) return undefined;
  const first = b.find((x) => x.weekIndex === Math.min(...weeks));
  const last = b.find((x) => x.weekIndex === Math.max(...weeks));
  if (!first || !last) return undefined;
  return `تمتد ${weeks.length} أسابيع`;
}

export function toTask(
  s: StepRow,
  ctx: { activityTitle: string; boundaries: WeekBoundary[]; asOf: string; canUpdate: boolean; departmentId?: string },
): TaskCardData {
  const e = evaluateStep({ id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks }, ctx.boundaries, ctx.asOf);
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    output: s.output,
    substeps: s.substeps,
    activityTitle: ctx.activityTitle,
    activityId: s.activity_id,
    responsible: s.responsible_text,
    assigneeName: s.assigneeName,
    dueDate: e.dueDate,
    isLate: e.isLate,
    daysLate: e.daysLate,
    progress: s.progress,
    evidenceCount: s.evidenceCount,
    canUpdate: ctx.canUpdate,
    departmentId: ctx.departmentId,
    weekSpan: weekSpanLabel(s.weeks, ctx.boundaries),
  };
}

export function monthName(m: number) {
  return MONTHS[m];
}
