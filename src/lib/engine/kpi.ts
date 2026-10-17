// =====================================================================
// احتساب تحقق مؤشرات الأداء السنوية (الأداء التنفيذي)
// منفصل تمامًا عن إنجاز الأنشطة (الأداء التشغيلي) ولا يدمج معه.
// =====================================================================
import { clamp, round2 } from './progress';

export type KpiType = 'numeric' | 'percentage' | 'financial' | 'qualitative';
export type KpiDirection = 'increase' | 'decrease';
export type KpiStatus = 'achieved' | 'on_track' | 'at_risk' | 'off_track' | 'no_data' | 'no_target';

export interface KpiInput {
  kpiType: KpiType;
  direction: KpiDirection;
  baseline: number | null;
  annualTarget: number | null;
  periodTargets: Record<number, number>; // ربع → مستهدف تراكمي
  actual: number | null; // آخر قيمة تراكمية
}

/**
 * نسبة التحقق:
 *  - زيادة دون خط أساس: الفعلي ÷ المستهدف
 *  - زيادة مع خط أساس: (الفعلي − الأساس) ÷ (المستهدف − الأساس)
 *  - انخفاض مع خط أساس: (الأساس − الفعلي) ÷ (الأساس − المستهدف)
 *  - انخفاض دون خط أساس: المستهدف ÷ الفعلي
 *  - النوعي: درجة التقييم (0..100) ÷ المستهدف
 */
export function achievementRatio(input: { direction: KpiDirection; baseline: number | null; target: number | null; actual: number | null }): number | null {
  const { direction, baseline, target, actual } = input;
  if (actual === null || actual === undefined || target === null || target === undefined) return null;
  if (direction === 'increase') {
    if (baseline !== null && baseline !== undefined && target !== baseline) {
      return (actual - baseline) / (target - baseline);
    }
    if (target === 0) return actual >= 0 ? 1 : 0;
    return actual / target;
  }
  // انخفاض
  if (baseline !== null && baseline !== undefined && baseline !== target) {
    return (baseline - actual) / (baseline - target);
  }
  if (actual <= 0) return 1;
  return target / actual;
}

/** المستهدف المتوقع حتى ربع معين: المستهدف المرحلي إن وجد، وإلا توزيع خطي للمستهدف السنوي */
export function expectedTarget(input: KpiInput, quarter: number): number | null {
  if (input.periodTargets[quarter] !== undefined) return input.periodTargets[quarter];
  if (input.annualTarget === null) return null;
  if (input.kpiType === 'percentage' || input.kpiType === 'qualitative' || input.direction === 'decrease') {
    // النسب والانخفاض لا تتراكم خطيًا: يقارن بالمستهدف السنوي
    return input.annualTarget;
  }
  const base = input.baseline ?? 0;
  return base + ((input.annualTarget - base) * quarter) / 4;
}

export interface KpiEval {
  achievement: number | null; // نسبة التحقق من المستهدف السنوي (0..∞، تعرض مقيدة)
  periodAchievement: number | null; // مقابل المستهدف المرحلي الحالي
  expected: number | null;
  status: KpiStatus;
}

export function evaluateKpi(input: KpiInput, currentQuarter: number): KpiEval {
  if (input.annualTarget === null) return { achievement: null, periodAchievement: null, expected: null, status: 'no_target' };
  if (input.actual === null) {
    return { achievement: null, periodAchievement: null, expected: expectedTarget(input, currentQuarter), status: 'no_data' };
  }
  const annual = achievementRatio({ direction: input.direction, baseline: input.baseline, target: input.annualTarget, actual: input.actual });
  const expected = expectedTarget(input, currentQuarter);
  const period = achievementRatio({ direction: input.direction, baseline: input.baseline, target: expected, actual: input.actual });
  let status: KpiStatus;
  if (annual !== null && annual >= 1) status = 'achieved';
  else if (period === null) status = 'no_data';
  else if (period >= 0.95) status = 'on_track';
  else if (period >= 0.75) status = 'at_risk';
  else status = 'off_track';
  return {
    achievement: annual === null ? null : round2(annual * 100),
    periodAchievement: period === null ? null : round2(period * 100),
    expected,
    status,
  };
}

export function displayPct(n: number | null): number | null {
  return n === null ? null : clamp(n, 0, 100);
}
