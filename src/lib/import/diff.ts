// =====================================================================
// مقارنة نسخة جديدة من ملف الخطة بالخطة الموجودة (إعادة الاستيراد)
// القواعد: لا حذف لإنجاز سابق، ولا تكرار لنشاط أو خطوة دون موافقة.
// =====================================================================
import { normalizeAr } from '../engine/weights';
import type { ParsedActivity } from './operational';

export interface ExistingStep {
  id: string;
  title: string;
  responsible_text: string | null;
  output: string | null;
  weeks: number[];
  progress: number;
  status: string;
}
export interface ExistingActivity {
  id: string;
  title: string;
  steps: ExistingStep[];
}

export type FieldChange = { field: 'responsible' | 'output' | 'weeks'; from: string; to: string };

export interface StepDiff {
  kind: 'added' | 'removed' | 'changed' | 'same';
  existingId?: string;
  title: string;
  changes: FieldChange[];
  hasProgress: boolean;
  parsed?: ParsedActivity['steps'][number];
}

export interface ActivityDiff {
  kind: 'added' | 'removed' | 'matched';
  existingId?: string;
  title: string;
  steps: StepDiff[];
  hasProgress: boolean;
  parsed?: ParsedActivity;
}

export interface PlanDiff {
  activities: ActivityDiff[];
  summary: {
    addedActivities: number;
    removedActivities: number;
    addedSteps: number;
    removedSteps: number;
    changedSteps: number;
    protectedItems: number; // عناصر بها إنجاز لن تحذف
  };
}

const key = (s: string) => normalizeAr(s).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const weeksStr = (w: number[]) => [...w].sort((a, b) => a - b).join(',');

function similar(a: string, b: string): boolean {
  const ka = key(a);
  const kb = key(b);
  if (ka === kb) return true;
  if (ka.length > 6 && kb.length > 6 && (ka.includes(kb) || kb.includes(ka))) return true;
  return false;
}

export function diffPlan(existing: ExistingActivity[], parsed: ParsedActivity[]): PlanDiff {
  const usedExisting = new Set<string>();
  const result: ActivityDiff[] = [];

  for (const pa of parsed) {
    const match =
      existing.find((ea) => !usedExisting.has(ea.id) && key(ea.title) === key(pa.title)) ??
      existing.find((ea) => !usedExisting.has(ea.id) && similar(ea.title, pa.title));
    if (!match) {
      result.push({
        kind: 'added',
        title: pa.title,
        hasProgress: false,
        parsed: pa,
        steps: pa.steps.map((s) => ({ kind: 'added', title: s.title, changes: [], hasProgress: false, parsed: s })),
      });
      continue;
    }
    usedExisting.add(match.id);
    const usedSteps = new Set<string>();
    const steps: StepDiff[] = [];
    for (const ps of pa.steps) {
      const es =
        match.steps.find((x) => !usedSteps.has(x.id) && key(x.title) === key(ps.title)) ??
        match.steps.find((x) => !usedSteps.has(x.id) && similar(x.title, ps.title));
      if (!es) {
        steps.push({ kind: 'added', title: ps.title, changes: [], hasProgress: false, parsed: ps });
        continue;
      }
      usedSteps.add(es.id);
      const changes: FieldChange[] = [];
      if ((es.responsible_text ?? '') !== (ps.responsible ?? '')) changes.push({ field: 'responsible', from: es.responsible_text ?? '', to: ps.responsible ?? '' });
      if ((es.output ?? '') !== (ps.output ?? '')) changes.push({ field: 'output', from: es.output ?? '', to: ps.output ?? '' });
      if (weeksStr(es.weeks) !== weeksStr(ps.weeks)) changes.push({ field: 'weeks', from: weeksStr(es.weeks), to: weeksStr(ps.weeks) });
      steps.push({
        kind: changes.length ? 'changed' : 'same',
        existingId: es.id,
        title: ps.title,
        changes,
        hasProgress: es.progress > 0 || es.status !== 'not_started',
        parsed: ps,
      });
    }
    for (const es of match.steps) {
      if (!usedSteps.has(es.id)) {
        steps.push({ kind: 'removed', existingId: es.id, title: es.title, changes: [], hasProgress: es.progress > 0 || es.status !== 'not_started' });
      }
    }
    result.push({ kind: 'matched', existingId: match.id, title: pa.title, steps, hasProgress: steps.some((s) => s.hasProgress), parsed: pa });
  }

  for (const ea of existing) {
    if (usedExisting.has(ea.id)) continue;
    const hp = ea.steps.some((s) => s.progress > 0 || s.status !== 'not_started');
    result.push({
      kind: 'removed',
      existingId: ea.id,
      title: ea.title,
      hasProgress: hp,
      steps: ea.steps.map((s) => ({ kind: 'removed', existingId: s.id, title: s.title, changes: [], hasProgress: s.progress > 0 || s.status !== 'not_started' })),
    });
  }

  const allSteps = result.flatMap((a) => a.steps);
  return {
    activities: result,
    summary: {
      addedActivities: result.filter((a) => a.kind === 'added').length,
      removedActivities: result.filter((a) => a.kind === 'removed').length,
      addedSteps: allSteps.filter((s) => s.kind === 'added').length,
      removedSteps: allSteps.filter((s) => s.kind === 'removed').length,
      changedSteps: allSteps.filter((s) => s.kind === 'changed').length,
      protectedItems: allSteps.filter((s) => s.kind === 'removed' && s.hasProgress).length,
    },
  };
}
