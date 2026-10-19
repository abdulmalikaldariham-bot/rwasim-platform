import { evaluateStep, effectiveWeeks } from '../engine/progress';
import type { WeekBoundary } from '../engine/types';
import { stepFact, type StepRow } from './plans';
import type { TaskCardData } from '@/components/tasks/task-card';
import { MONTHS } from '../labels';

export function weekSpanLabel(weeks: number[]): string | undefined {
  if (weeks.length <= 1) return undefined;
  return `تمتد ${weeks.length} أسابيع`;
}

/** هل يمكن الإكمال بنقرة واحدة؟ (مهمة مشتركة دون مراحل، ولا يلزمها توثيق أو وُثق مخرجها) */
export function canQuickComplete(s: StepRow) {
  return s.assignment_mode === 'shared' && s.substeps.length === 0 && (s.output_policy === 'none' || (s.output_policy === 'description' && !!s.output_achieved?.trim()));
}

export function toTask(
  s: StepRow,
  ctx: { activityTitle: string; boundaries: WeekBoundary[]; asOf: string; canUpdate: boolean; departmentId?: string; departmentName?: string; me?: string },
): TaskCardData {
  const e = evaluateStep(stepFact(s), ctx.boundaries, ctx.asOf);
  const mine = ctx.me ? s.assignees.find((a) => a.user_id === ctx.me) : undefined;
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    output: s.output,
    outputAchieved: s.output_achieved,
    substeps: s.substeps,
    activityTitle: ctx.activityTitle,
    activityId: s.activity_id,
    departmentName: ctx.departmentName,
    responsible: s.responsible_text,
    assigneeName: s.assigneeName,
    assigneesCount: s.assignees.length + s.external_assignees.length,
    startDate: e.startDate,
    dueDate: e.dueDate,
    datesSource: s.dates_source,
    timeState: e.timeState,
    isLate: e.isLate,
    daysLate: e.daysLate,
    progress: s.progress,
    evidenceCount: s.evidenceCount,
    canUpdate: ctx.canUpdate,
    quick: ctx.canUpdate && canQuickComplete(s),
    individual: s.assignment_mode === 'individual',
    myDone: mine ? mine.status === 'completed' : undefined,
    departmentId: ctx.departmentId,
    weekSpan: weekSpanLabel(effectiveWeeks(stepFact(s), ctx.boundaries)),
  };
}

export function monthName(m: number) {
  return MONTHS[m];
}
