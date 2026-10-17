// =====================================================================
// اقتراح الأوزان — اقتراحات فقط، تتطلب مراجعة واعتمادًا بشريًا
// =====================================================================
import type { ActivityKind } from './types';
import { round2 } from './progress';

export const CORE_STEP_WEIGHT = 40;

/** توحيد النص العربي للمطابقة: إزالة التشكيل وتوحيد الهمزات والتاء المربوطة والمسافات */
export function normalizeAr(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[ً-ْٰـ]/g, '') // تشكيل وتطويل
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ \s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** توزيع إجمالي على عدد من البنود بدقة خانتين مع تصحيح فرق التقريب في آخر بند */
export function distribute(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((total / n) * 100) / 100;
  const out = Array(n).fill(base);
  out[n - 1] = round2(total - base * (n - 1));
  return out;
}

/** تطبيع قائمة أوزان لتساوي 100 */
export function normalizeTo100(weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return distribute(100, weights.length);
  const scaled = weights.map((w) => Math.floor(((w / total) * 100) * 100) / 100);
  const diff = round2(100 - scaled.reduce((s, w) => s + w, 0));
  // يضاف فرق التقريب إلى أكبر وزن
  const iMax = scaled.indexOf(Math.max(...scaled));
  scaled[iMax] = round2(scaled[iMax] + diff);
  return scaled;
}

// ---------------------------------------------------------------------
// تصنيف النشاط
// ---------------------------------------------------------------------

const PROJECT_PHASES: { key: string; patterns: RegExp[]; weight: number }[] = [
  { key: 'mature', patterns: [/انضاج/, /بلوره/], weight: 10 },
  { key: 'document', patterns: [/تسليم وثيقه/, /اعداد الوثيقه/, /كتابه الوثيقه/, /وثيقه المشروع/], weight: 10 },
  { key: 'approve', patterns: [/اعتماد/], weight: 10 },
  { key: 'prepare', patterns: [/اعداد المشروع/, /تجهيز/, /الاعداد/], weight: 20 },
  { key: 'execute', patterns: [/تنفيذ(?!ي)/], weight: 40 },
  { key: 'close', patterns: [/اغلاق/, /التقرير الختامي/], weight: 10 },
];

function phaseOf(title: string): string | null {
  const t = normalizeAr(title);
  // ترتيب الفحص مهم: "اعتماد وثيقة المشروع" يجب أن تكون اعتمادًا لا وثيقة
  if (/اعتماد/.test(t)) return 'approve';
  for (const p of PROJECT_PHASES) if (p.patterns.some((r) => r.test(t))) return p.key;
  return null;
}

export function isProjectLifecycle(stepTitles: string[]): boolean {
  const phases = stepTitles.map(phaseOf);
  const set = new Set(phases.filter(Boolean));
  return set.has('execute') && (set.has('mature') || set.has('close')) && set.size >= 4 && phases.every(Boolean);
}

export function classifyActivity(title: string, stepTitles: string[]): ActivityKind {
  const t = normalizeAr(title);
  const steps = stepTitles.map(normalizeAr).join(' | ');
  if (isProjectLifecycle(stepTitles) || /مشروع|مشوار|باديه/.test(t)) return 'project';
  if (/دوري|الدوريه|شهري|حسب الحاجه|متابعه المقر|صيانه|البريد|التصاميم|الحجوزات|جدوله|النشره|المتابعه والرفع/.test(t)) return 'recurring';
  if (/انشاء|بناء|تاسيس/.test(t) || /تنفيذ اعمال البناء/.test(steps)) return 'construction';
  if (/تخطيط|خطه|الخطه|دليل|الدليل|سياسات|مصفوفه|تحديث/.test(t) || /كتابه الخطه|كتابه الدليل/.test(steps)) return 'planning';
  return 'other';
}

export const KIND_LABELS: Record<ActivityKind, string> = {
  project: 'مشروع',
  planning: 'تخطيط وتوثيق',
  construction: 'إنشاء وتأسيس',
  recurring: 'عمل متكرر',
  admin: 'عمل إداري',
  other: 'نشاط عام',
};

// ---------------------------------------------------------------------
// الخطوة الجوهرية
// ---------------------------------------------------------------------

const CORE_PATTERNS: Record<ActivityKind, RegExp[]> = {
  project: [/تنفيذ(?!ي)/],
  construction: [/تنفيذ(?!ي)/, /بناء/, /انشاء/, /تاسيس/],
  planning: [/كتابه/, /صياغه/, /اعداد/, /التحسين/, /تحديث/, /التعديل/],
  recurring: [/تنفيذ(?!ي)/, /توفير/, /نشر/, /اصدار/, /البدء في التصميم/, /صيانه/, /اعداد و?تحديث/],
  admin: [/تنفيذ(?!ي)/, /اقامه/, /اجراء/, /اعداد/],
  other: [/تنفيذ(?!ي)/, /اقامه/, /اجراء/, /كتابه/, /اعداد/, /زياره/, /التواصل/, /تحليل/],
};

/** يعيد فهرس الخطوة الجوهرية المقترحة */
export function detectCoreStep(kind: ActivityKind, steps: { title: string; weeks?: number[] }[]): number {
  if (steps.length === 0) return -1;
  const titles = steps.map((s) => normalizeAr(s.title));
  for (const r of CORE_PATTERNS[kind] ?? CORE_PATTERNS.other) {
    const i = titles.findIndex((t) => r.test(t));
    if (i >= 0) return i;
  }
  for (const r of CORE_PATTERNS.other) {
    const i = titles.findIndex((t) => r.test(t));
    if (i >= 0) return i;
  }
  // البديل: الخطوة الأطول جدولة، ثم الوسطى
  const spans = steps.map((s) => s.weeks?.length ?? 0);
  const maxSpan = Math.max(...spans);
  if (maxSpan > 0) return spans.indexOf(maxSpan);
  return Math.floor((steps.length - 1) / 2);
}

export interface StepWeightSuggestion {
  weights: number[];
  coreIndex: number;
  method: 'single' | 'project_template' | 'core_40' | 'equal';
  explanation: string;
}

/**
 * اقتراح أوزان الخطوات:
 *  - خطوة واحدة: 100٪
 *  - دورة مشروع كاملة: القالب المعتمد (10/10/10/20/40/10) مطبعًا للخطوات الموجودة
 *  - غير ذلك: الخطوة الجوهرية 40٪ والباقي يوزع بالتساوي (60٪)
 *  - خطوتان فقط: 50/50 (لأن 40٪ للجوهرية يعني أن الأخرى أثقل منها)
 */
export function suggestStepWeights(kind: ActivityKind, steps: { title: string; weeks?: number[] }[]): StepWeightSuggestion {
  const n = steps.length;
  if (n === 0) return { weights: [], coreIndex: -1, method: 'equal', explanation: '' };
  if (n === 1) return { weights: [100], coreIndex: 0, method: 'single', explanation: 'خطوة واحدة تأخذ وزن النشاط كاملًا' };

  if (isProjectLifecycle(steps.map((s) => s.title))) {
    const raw = steps.map((s) => PROJECT_PHASES.find((p) => p.key === phaseOf(s.title))?.weight ?? 10);
    const weights = normalizeTo100(raw);
    const coreIndex = steps.findIndex((s) => phaseOf(s.title) === 'execute');
    return {
      weights,
      coreIndex,
      method: 'project_template',
      explanation: 'قالب المشاريع: إنضاج 10٪، الوثيقة 10٪، الاعتماد 10٪، التجهيز 20٪، التنفيذ 40٪، الإغلاق 10٪',
    };
  }

  const coreIndex = detectCoreStep(kind, steps);
  if (n === 2) {
    return { weights: [50, 50], coreIndex, method: 'equal', explanation: 'خطوتان: توزيع متساوٍ (يمكن تعديله)' };
  }
  const rest = distribute(100 - CORE_STEP_WEIGHT, n - 1);
  const weights: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) weights.push(i === coreIndex ? CORE_STEP_WEIGHT : rest[k++]);
  return {
    weights,
    coreIndex,
    method: 'core_40',
    explanation: `الخطوة الجوهرية 40٪، و60٪ موزعة بالتساوي على ${n - 1} خطوات`,
  };
}

// ---------------------------------------------------------------------
// أوزان الأنشطة داخل الإدارة
// ---------------------------------------------------------------------

const KIND_FACTOR: Record<ActivityKind, number> = {
  project: 1.5,
  construction: 1.4,
  planning: 1.2,
  other: 1,
  recurring: 0.8,
  admin: 0.8,
};

export function suggestActivityWeightsEqual(n: number): number[] {
  if (n > 0 && 100 % n === 0) return Array(n).fill(100 / n);
  return distribute(100, n);
}

/**
 * تقسيم 100 على بنود بنسب معينة بطريقة «أكبر باقٍ» بوحدات صحيحة (5٪ افتراضيًا)
 * لتبقى الأوزان المقترحة أرقامًا سهلة المراجعة ومجموعها 100 تمامًا.
 */
export function apportion(scores: number[], step = 5): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const unit = n * step > 100 ? 1 : step;
  const units = Math.round(100 / unit);
  const total = scores.reduce((s, x) => s + Math.max(0, x), 0) || n;
  const exact = scores.map((s) => ((Math.max(0, s) || (total === n ? 1 : 0)) / total) * units);
  const alloc = exact.map((e) => Math.max(1, Math.floor(e)));
  let remaining = units - alloc.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  let k = 0;
  while (remaining > 0) {
    alloc[order[k % n].i] += 1;
    remaining--;
    k++;
  }
  while (remaining < 0) {
    const iMax = alloc.indexOf(Math.max(...alloc));
    alloc[iMax] -= 1;
    remaining++;
  }
  const out = alloc.map((a) => a * unit);
  const diff = round2(100 - out.reduce((s, x) => s + x, 0));
  if (diff !== 0) out[out.indexOf(Math.max(...out))] = round2(out[out.indexOf(Math.max(...out))] + diff);
  return out;
}

/** اقتراح بحسب طبيعة النشاط وحجمه (عدد الخطوات وامتداد الجدولة) — للمراجعة البشرية */
export function suggestActivityWeightsByNature(
  activities: { kind: ActivityKind; steps: { weeks?: number[] }[] }[],
): number[] {
  if (activities.length === 0) return [];
  const scores = activities.map((a) => {
    const stepCount = Math.max(1, a.steps.length);
    const weeks = new Set(a.steps.flatMap((s) => s.weeks ?? [])).size;
    const size = Math.sqrt(stepCount) * (1 + Math.min(weeks, 12) / 24);
    return KIND_FACTOR[a.kind] * size;
  });
  return apportion(scores, 5);
}

// ---------------------------------------------------------------------
// المراحل الفرعية للأعمال المتكررة (دورات شهرية)
// ---------------------------------------------------------------------

const MONTHS_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export function monthNameAr(m: number): string {
  return MONTHS_AR[m] ?? String(m);
}

/** للخطوة المتكررة المجدولة في أكثر من شهر: دورة لكل شهر بوزن متساوٍ */
export function suggestCycleSubsteps(weeks: number[], quarter: number): { title: string; weight: number }[] {
  const months = Array.from(new Set(weeks.map((w) => (quarter - 1) * 3 + Math.floor((w - 1) / 4) + 1))).sort((a, b) => a - b);
  if (months.length < 2) return [];
  const ws = distribute(100, months.length);
  return months.map((m, i) => ({ title: `دورة شهر ${monthNameAr(m)}`, weight: ws[i] }));
}
