// =====================================================================
// قارئ الخطة التنفيذية السنوية من Excel (وفق القالب القابل للتنزيل)
// =====================================================================
import ExcelJS from 'exceljs';
import { normalizeAr } from '../engine/weights';
import { cleanText, toLatinDigits, type ImportIssue } from './operational';
import type { KpiDirection, KpiType } from '../engine/kpi';

export type Frequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface ParsedKpi {
  row: number;
  axis: string;
  goal: string;
  code: string | null;
  name: string;
  definition: string | null;
  calcMethod: string | null;
  unit: string | null;
  kpiType: KpiType;
  direction: KpiDirection;
  baseline: number | null;
  annualTarget: number | null;
  periodTargets: Record<number, number>;
  department: string | null;
  frequency: Frequency;
  dataSource: string | null;
}

export interface ParsedExecPlan {
  axes: { title: string; goals: { title: string; kpis: ParsedKpi[] }[] }[];
  kpis: ParsedKpi[];
  issues: ImportIssue[];
}

export const EXEC_COLUMNS = [
  { key: 'axis', label: 'المحور / التوجه', width: 22 },
  { key: 'goal', label: 'الهدف التنفيذي', width: 30 },
  { key: 'code', label: 'رمز المؤشر', width: 10 },
  { key: 'name', label: 'مؤشر الأداء', width: 30 },
  { key: 'definition', label: 'تعريف المؤشر', width: 30 },
  { key: 'calcMethod', label: 'طريقة الاحتساب', width: 26 },
  { key: 'unit', label: 'وحدة القياس', width: 12 },
  { key: 'kpiType', label: 'نوع المؤشر (عددي/نسبة/مالي/نوعي)', width: 16 },
  { key: 'direction', label: 'اتجاه التحسن (زيادة/انخفاض)', width: 14 },
  { key: 'baseline', label: 'خط الأساس', width: 11 },
  { key: 'annualTarget', label: 'المستهدف السنوي', width: 12 },
  { key: 'q1', label: 'مستهدف حتى الربع 1', width: 11 },
  { key: 'q2', label: 'مستهدف حتى الربع 2', width: 11 },
  { key: 'q3', label: 'مستهدف حتى الربع 3', width: 11 },
  { key: 'q4', label: 'مستهدف حتى الربع 4', width: 11 },
  { key: 'department', label: 'الإدارة المسؤولة', width: 20 },
  { key: 'frequency', label: 'دورية القياس (شهري/ربعي/نصف سنوي/سنوي)', width: 16 },
  { key: 'dataSource', label: 'مصدر البيانات والشواهد', width: 24 },
] as const;

function num(v: unknown): number | null {
  const t = cleanText(v);
  if (!t) return null;
  const n = Number(toLatinDigits(t).replace(/[,٬%٪\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function kpiTypeOf(t: string | null): KpiType {
  const n = normalizeAr(t);
  if (/نسب|%|٪/.test(n)) return 'percentage';
  if (/مال|ريال/.test(n)) return 'financial';
  if (/نوع/.test(n)) return 'qualitative';
  return 'numeric';
}
function directionOf(t: string | null): KpiDirection {
  return /انخفاض|نقص|اقل|تقليل/.test(normalizeAr(t)) ? 'decrease' : 'increase';
}
function frequencyOf(t: string | null): Frequency {
  const n = normalizeAr(t);
  if (/شهر/.test(n)) return 'monthly';
  if (/نصف/.test(n)) return 'semiannual';
  if (/سنو/.test(n)) return 'annual';
  return 'quarterly';
}

export async function parseExecutiveWorkbook(data: ArrayBuffer | Buffer): Promise<ParsedExecPlan> {
  const wb = new ExcelJS.Workbook();
   
  await wb.xlsx.load(data as any);
  const issues: ImportIssue[] = [];
  const ws = wb.worksheets.find((w) => w.state === 'visible' || !w.state) ?? wb.worksheets[0];
  const sheet = ws?.name ?? '';
  if (!ws) return { axes: [], kpis: [], issues: [{ level: 'error', sheet, message: 'الملف لا يحتوي أوراق عمل' }] };

  // صف العناوين
  let headerRow = -1;
  const colOf: Partial<Record<(typeof EXEC_COLUMNS)[number]['key'], number>> = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const found: typeof colOf = {};
    row.eachCell((cell, c) => {
      const t = normalizeAr(cleanText(cell.value));
      for (const col of EXEC_COLUMNS) {
        const lt = normalizeAr(col.label);
        const head = lt.split(' (')[0];
        if (t && (t === lt || t.startsWith(head))) {
          if (!found[col.key]) found[col.key] = c;
          break;
        }
      }
    });
    if (found.name && (found.goal || found.axis)) {
      headerRow = r;
      Object.assign(colOf, found);
      break;
    }
  }
  if (headerRow < 0) {
    return { axes: [], kpis: [], issues: [{ level: 'error', sheet, message: 'لم يتم التعرف على أعمدة القالب (المحور، الهدف، المؤشر...). استخدم قالب الخطة التنفيذية.' }] };
  }

  const get = (row: ExcelJS.Row, k: keyof typeof colOf) => (colOf[k] ? row.getCell(colOf[k]!).value : null);
  const kpis: ParsedKpi[] = [];
  let lastAxis = '';
  let lastGoal = '';
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cleanText(get(row, 'name'));
    const axis = cleanText(get(row, 'axis')) ?? lastAxis;
    const goal = cleanText(get(row, 'goal')) ?? lastGoal;
    if (cleanText(get(row, 'axis'))) lastAxis = axis;
    if (cleanText(get(row, 'goal'))) lastGoal = goal;
    if (!name) continue;
    const periodTargets: Record<number, number> = {};
    (['q1', 'q2', 'q3', 'q4'] as const).forEach((q, i) => {
      const v = num(get(row, q));
      if (v !== null) periodTargets[i + 1] = v;
    });
    const k: ParsedKpi = {
      row: r,
      axis: axis || 'محور عام',
      goal: goal || 'هدف عام',
      code: cleanText(get(row, 'code')),
      name,
      definition: cleanText(get(row, 'definition')),
      calcMethod: cleanText(get(row, 'calcMethod')),
      unit: cleanText(get(row, 'unit')),
      kpiType: kpiTypeOf(cleanText(get(row, 'kpiType'))),
      direction: directionOf(cleanText(get(row, 'direction'))),
      baseline: num(get(row, 'baseline')),
      annualTarget: num(get(row, 'annualTarget')),
      periodTargets,
      department: cleanText(get(row, 'department')),
      frequency: frequencyOf(cleanText(get(row, 'frequency'))),
      dataSource: cleanText(get(row, 'dataSource')),
    };
    if (k.annualTarget === null) issues.push({ level: 'warning', sheet, row: r, message: `المؤشر «${name}» بلا مستهدف سنوي` });
    if (!k.department) issues.push({ level: 'warning', sheet, row: r, message: `المؤشر «${name}» بلا إدارة مسؤولة` });
    if (!axis) issues.push({ level: 'info', sheet, row: r, message: `المؤشر «${name}» بلا محور؛ أدرج تحت «محور عام»` });
    kpis.push(k);
  }
  if (!kpis.length) issues.push({ level: 'error', sheet, message: 'لم يتم العثور على أي مؤشرات' });

  const axes: ParsedExecPlan['axes'] = [];
  for (const k of kpis) {
    let ax = axes.find((a) => a.title === k.axis);
    if (!ax) axes.push((ax = { title: k.axis, goals: [] }));
    let g = ax.goals.find((x) => x.title === k.goal);
    if (!g) ax.goals.push((g = { title: k.goal, kpis: [] }));
    g.kpis.push(k);
  }
  return { axes, kpis, issues };
}
