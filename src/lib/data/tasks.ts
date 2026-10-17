import { evaluateStep } from '../engine/progress';
import type { ActivityKind, StepTiming, WeekBoundary } from '../engine/types';
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
  ctx: {
    activityTitle: string;
    activityKind?: ActivityKind;
    deptName?: string;
    boundaries: WeekBoundary[];
    asOf: string;
    canUpdate: boolean;
    departmentId?: string;
    viewerId?: string;
  },
): TaskCardData & { timing: StepTiming; startDate: string | null } {
  const e = evaluateStep(
    { id: s.id, weight: s.weight, progress: s.progress, status: s.status, weeks: s.weeks, plannedStart: s.planned_start, plannedEnd: s.planned_end },
    ctx.boundaries,
    ctx.asOf,
  );
  const mine = ctx.viewerId ? s.assignees.find((a) => a.user_id === ctx.viewerId) : undefined;
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    output: s.output,
    actualOutput: s.actual_output,
    outputRequirement: s.output_requirement,
    substeps: s.substeps,
    isCore: s.is_core,
    activityTitle: ctx.activityTitle,
    activityKind: ctx.activityKind,
    activityId: s.activity_id,
    deptName: ctx.deptName,
    responsible: s.responsible_text,
    assigneeName: s.assigneeName,
    assignees: s.assignees.map((a) => ({ name: a.name, isLead: a.is_lead, status: a.status })),
    mode: s.assignment_mode,
    myStatus: s.assignment_mode === 'individual' ? mine?.status ?? null : null,
    myOutput: mine?.output_note ?? null,
    isAssignee: !!mine,
    dueDate: e.dueDate,
    startDate: e.startDate,
    timing: e.timing,
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

/** هل تتقاطع فترة المهمة مع فترة معينة؟ */
export function overlaps(start: string | null, end: string | null, from: string, to: string): boolean {
  if (!end) return false;
  const s = start ?? end;
  return s <= to && end >= from;
}
