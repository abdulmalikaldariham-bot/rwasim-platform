// =====================================================================
// قارئ الخطط التشغيلية من Excel
// ---------------------------------------------------------------------
// يتعرف على: صف العناوين، أعمدة (الرقم/النشاط/الخطوات/المسؤول/المخرج/المتابعة)،
// أعمدة الأسابيع تحت «شهرNN» و«س1..س4»، والجدولة سواء كانت بعلامات
// (*، أرقام) أو بتلوين الخلايا. لا يختلق أي تاريخ أو إنجاز.
// =====================================================================
import ExcelJS from 'exceljs';
import { normalizeAr } from '../engine/weights';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface ImportIssue {
  level: IssueLevel;
  sheet: string;
  row?: number;
  message: string;
}

export interface ParsedStep {
  seq: number;
  row: number;
  title: string;
  responsible: string | null;
  output: string | null;
  followup: string | null; // كما ورد — للمراجعة فقط
  weeks: number[]; // 1..12 داخل الربع
  intensities: Record<number, number>; // قيم رقمية في خلايا الأسابيع
  scheduleSource: 'marks' | 'fill' | 'none';
}

export interface ParsedActivity {
  seq: number;
  row: number;
  number: string | null;
  title: string;
  steps: ParsedStep[];
}

export interface ParsedSheet {
  sheetName: string;
  title: string | null;
  departmentHint: string | null; // الاسم بين القوسين في العنوان أو من اسم الورقة
  year: number | null;
  quarter: number | null;
  months: number[];
  scheduleMode: 'marks' | 'fill' | 'mixed' | 'none';
  /** الأعمدة التي تعرف عليها القارئ (للعرض في خطوة المطابقة) */
  columns: { field: string; column: string; header: string }[];
  activities: ParsedActivity[];
  issues: ImportIssue[];
  stats: { activities: number; steps: number; scheduledSteps: number };
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  issues: ImportIssue[];
}

// ---------------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------------

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(Math.max(AR_DIGITS.indexOf(d), FA_DIGITS.indexOf(d))));
}

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(o.richText)) s = o.richText.map((r) => r.text).join('');
    else if (typeof o.text === 'string') s = o.text;
    else if (o.result !== undefined) s = String(o.result);
    else s = String(v);
  } else s = String(v);
  s = s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  return s.length ? s : null;
}

const QUARTER_WORDS: [RegExp, number][] = [
  [/الاول/, 1],
  [/الثاني/, 2],
  [/الثالث/, 3],
  [/الرابع/, 4],
];

export function parseTitle(title: string | null): { year: number | null; quarter: number | null; department: string | null } {
  if (!title) return { year: null, quarter: null, department: null };
  const t = toLatinDigits(title);
  const n = normalizeAr(t);
  const year = Number(t.match(/(20\d{2})/)?.[1]) || null;
  let quarter: number | null = null;
  const qm = n.match(/الربع\s+(\S+)/);
  if (qm) for (const [r, q] of QUARTER_WORDS) if (r.test(qm[1])) quarter = q;
  const dm = title.match(/\(([^)]+)\)/);
  const department = dm ? dm[1].replace(/\s+/g, ' ').trim() : null;
  return { year, quarter, department };
}

type FillKey = string | null;
function fillKey(cell: ExcelJS.Cell): FillKey {
  const f = cell.fill as ExcelJS.FillPattern | undefined;
  if (!f || f.type !== 'pattern' || !f.pattern || f.pattern === 'none') return null;
  const c = f.fgColor as { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined;
  if (!c) return null;
  if (c.argb) {
    const argb = c.argb.toUpperCase();
    if (argb === 'FFFFFFFF' || argb === '00000000' || argb === '00FFFFFF') return null;
    return 'rgb:' + argb;
  }
  if (c.theme !== undefined) {
    // السمة 0 بدون تظليل = أبيض عادة
    if (c.theme === 0 && !c.tint) return null;
    return `th:${c.theme}:${(c.tint ?? 0).toFixed(2)}`;
  }
  if (c.indexed !== undefined) {
    if (c.indexed === 64 || c.indexed === 9) return null;
    return 'idx:' + c.indexed;
  }
  return null;
}

// ---------------------------------------------------------------------
// تحليل ورقة
// ---------------------------------------------------------------------

interface Header {
  row: number;
  col: { number?: number; activity?: number; step?: number; responsible?: number; output?: number; followup?: number; progress?: number };
  weekCols: { col: number; weekIndex: number; month: number }[];
  months: number[];
}

function findHeader(ws: ExcelJS.Worksheet): Header | null {
  const maxScan = Math.min(ws.rowCount, 15);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const cols: Header['col'] = {};
    const monthCols: { col: number; month: number }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const t = normalizeAr(cleanText(cell.value));
      if (!t) return;
      if (/^الرقم|^م$|^#/.test(t)) cols.number = c;
      else if (/البرنامج|النشاط/.test(t) && !/الخطوات/.test(t)) cols.activity = c;
      else if (/الخطوات/.test(t)) cols.step = c;
      else if (/المسوول|المسؤول|المسووليه/.test(t)) cols.responsible = c;
      else if (/المخرج/.test(t)) cols.output = c;
      else if (/^المتابعه/.test(t)) cols.followup = c;
      else if (/نسبه الانجاز/.test(t)) cols.progress = c;
      const mm = toLatinDigits(t).match(/شهر\s*(\d{1,2})/);
      if (mm) monthCols.push({ col: c, month: Number(mm[1]) });
    });
    if (cols.step && (cols.activity || cols.number)) {
      // أعمدة الأسابيع: في الصف التالي (س1..س4) تحت كل شهر
      const weekRow = ws.getRow(r + 1);
      const weekCols: Header['weekCols'] = [];
      const monthsSorted = monthCols.sort((a, b) => a.col - b.col);
      monthsSorted.forEach((m, mi) => {
        const nextCol = monthsSorted[mi + 1]?.col ?? m.col + 4;
        for (let c = m.col; c < nextCol && c < m.col + 6; c++) {
          const t = toLatinDigits(normalizeAr(cleanText(weekRow.getCell(c).value)));
          const wm = t.match(/س\s*(\d)/) || t.match(/^(\d)$/) || t.match(/اسبوع\s*(\d)/);
          if (wm) {
            const wom = Number(wm[1]);
            if (wom >= 1 && wom <= 4) weekCols.push({ col: c, weekIndex: mi * 4 + wom, month: m.month });
          }
        }
        // إن لم توجد عناوين أسابيع، تفترض 4 أعمدة متتالية
        if (!weekCols.some((w) => w.month === m.month)) {
          for (let k = 0; k < 4; k++) weekCols.push({ col: m.col + k, weekIndex: mi * 4 + k + 1, month: m.month });
        }
      });
      return { row: r, col: cols, weekCols, months: monthsSorted.map((m) => m.month) };
    }
  }
  return null;
}

export function parseSheet(ws: ExcelJS.Worksheet): ParsedSheet {
  const sheetName = ws.name.trim();
  const issues: ImportIssue[] = [];
  const issue = (level: IssueLevel, message: string, row?: number) => issues.push({ level, sheet: sheetName, row, message });

  // العنوان: أول خلية نصية في الصفوف الأولى قبل صف العناوين
  const header = findHeader(ws);
  let title: string | null = null;
  for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
    const v = cleanText(ws.getRow(r).getCell(1).value);
    if (v && v.length > 15) {
      title = v;
      break;
    }
  }
  const parsedTitle = parseTitle(title);
  let departmentHint = parsedTitle.department;
  if (!departmentHint) {
    const m = sheetName.replace(/الخطة\s*التشغيلي+ة?\s*/g, '').replace(/^ل/, '').trim();
    departmentHint = m || null;
  }

  const base: ParsedSheet = {
    sheetName,
    title,
    departmentHint,
    year: parsedTitle.year,
    quarter: parsedTitle.quarter,
    months: [],
    scheduleMode: 'none',
    columns: [],
    activities: [],
    issues,
    stats: { activities: 0, steps: 0, scheduledSteps: 0 },
  };

  if (!header) {
    issue('error', 'لم يتم العثور على صف العناوين (البرنامج / النشاط، الخطوات التفصيلية...)');
    return base;
  }
  base.months = header.months;
  const FIELD_NAMES: Record<string, string> = { number: 'الرقم', activity: 'البرنامج / النشاط', step: 'الخطوة', responsible: 'المسؤول', output: 'المخرج', followup: 'المتابعة (للمراجعة)', progress: 'نسبة الإنجاز (لا تستورد)' };
  base.columns = Object.entries(header.col).map(([k, c]) => ({
    field: FIELD_NAMES[k] ?? k,
    column: ws.getColumn(c!).letter,
    header: cleanText(ws.getRow(header.row).getCell(c!).value) ?? '',
  }));
  if (header.weekCols.length) {
    base.columns.push({
      field: 'الجدولة الأسبوعية',
      column: `${ws.getColumn(header.weekCols[0].col).letter}–${ws.getColumn(header.weekCols.at(-1)!.col).letter}`,
      header: `${header.weekCols.length} أسبوعًا (${header.months.map((m) => 'شهر ' + m).join('، ')})`,
    });
  }
  if (header.months.length) {
    const qFromMonths = Math.ceil(header.months[0] / 3);
    if (base.quarter && base.quarter !== qFromMonths) {
      issue('warning', `الربع في العنوان (${base.quarter}) لا يطابق أشهر الجدولة (${header.months.join('، ')})`);
    }
    if (!base.quarter) base.quarter = qFromMonths;
    const qs = new Set(header.months.map((m) => Math.ceil(m / 3)));
    if (qs.size > 1) issue('warning', 'أعمدة الأشهر تمتد عبر أكثر من ربع؛ راجع حدود الأسابيع');
  } else {
    issue('warning', 'لم يتم التعرف على أعمدة الأشهر والأسابيع؛ ستستورد الخطوات دون جدولة');
  }
  if (header.col.progress) issue('info', 'عمود «نسبة الإنجاز» في الملف لا يُستورد؛ الإنجاز يُسجل في المنصة فقط');

  const first = header.row + (header.weekCols.length ? 2 : 1);
  const C = header.col;

  // تحديد طريقة الجدولة: علامات أم تلوين
  const fillCounts = new Map<string, number>();
  let markCount = 0;
  let totalWeekCells = 0;
  for (let r = first; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (const w of header.weekCols) {
      const cell = row.getCell(w.col);
      totalWeekCells++;
      if (cleanText(cell.value)) markCount++;
      const k = fillKey(cell);
      if (k) fillCounts.set(k, (fillCounts.get(k) ?? 0) + 1);
    }
  }
  // لون يغطي (تقريبًا) كل خلايا الأسابيع = خلفية وليس جدولة
  const markerFills = new Set(
    [...fillCounts.entries()].filter(([, n]) => n < totalWeekCells * 0.9).map(([k]) => k),
  );
  const useFill = markerFills.size > 0;
  if (markCount > 0 && useFill) base.scheduleMode = 'mixed';
  else if (markCount > 0) base.scheduleMode = 'marks';
  else if (useFill) base.scheduleMode = 'fill';

  let current: ParsedActivity | null = null;
  let lastMaster: string | null = null;
  let activitySeq = 0;

  for (let r = first; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const actCell = C.activity ? row.getCell(C.activity) : null;
    const numCell = C.number ? row.getCell(C.number) : null;
    const actMaster = actCell ? (actCell.isMerged ? actCell.master.address : actCell.address) : null;
    const numMaster = numCell ? (numCell.isMerged ? numCell.master.address : numCell.address) : null;
    const actText = actCell ? cleanText(actCell.value) : null;
    const numText = numCell ? cleanText(numCell.value) : null;
    const stepText = C.step ? cleanText(row.getCell(C.step).value) : null;

    // بداية نشاط جديد: خلية النشاط (أو الرقم) هي الخلية الرئيسية في نطاق دمجها
    const isNewBlock =
      (actCell && actText && actMaster === actCell.address) ||
      (numCell && numText && numMaster === numCell.address && numMaster !== lastMaster);

    if (isNewBlock) {
      lastMaster = numMaster ?? actMaster;
      if (!actText) {
        // رقم بلا نشاط: نشاط فارغ — يتجاهل ويبلغ عنه
        const hasStepsBelow = !!stepText;
        issue(
          hasStepsBelow ? 'error' : 'warning',
          hasStepsBelow
            ? `النشاط رقم ${numText} بلا اسم رغم وجود خطوات تحته`
            : `النشاط رقم ${numText} فارغ (لا اسم ولا خطوات) — تم تجاهله`,
          r,
        );
        current = hasStepsBelow
          ? { seq: ++activitySeq, row: r, number: numText, title: `نشاط رقم ${numText} (بلا اسم)`, steps: [] }
          : null;
        if (current) base.activities.push(current);
      } else {
        current = { seq: ++activitySeq, row: r, number: numText, title: actText, steps: [] };
        base.activities.push(current);
      }
    }

    if (!stepText) continue;
    if (!current) {
      issue('error', `خطوة «${stepText}» بلا نشاط تابعة له`, r);
      current = { seq: ++activitySeq, row: r, number: null, title: 'أنشطة غير مصنفة', steps: [] };
      base.activities.push(current);
    }

    const weeks: number[] = [];
    const intensities: Record<number, number> = {};
    let source: ParsedStep['scheduleSource'] = 'none';
    for (const w of header.weekCols) {
      const cell = row.getCell(w.col);
      const v = cleanText(cell.value);
      const k = fillKey(cell);
      if (v) {
        weeks.push(w.weekIndex);
        const num = Number(toLatinDigits(v));
        if (Number.isFinite(num) && num > 0) intensities[w.weekIndex] = num;
        source = 'marks';
      } else if (useFill && k && markerFills.has(k)) {
        weeks.push(w.weekIndex);
        if (source === 'none') source = 'fill';
      }
    }

    const responsible = C.responsible ? cleanText(row.getCell(C.responsible).value) : null;
    const output = C.output ? cleanText(row.getCell(C.output).value) : null;
    const followup = C.followup ? cleanText(row.getCell(C.followup).value) : null;

    const step: ParsedStep = {
      seq: current.steps.length + 1,
      row: r,
      title: stepText,
      responsible,
      output,
      followup,
      weeks: [...new Set(weeks)].sort((a, b) => a - b),
      intensities,
      scheduleSource: source,
    };
    current.steps.push(step);

    if (!responsible) issue('warning', `الخطوة «${stepText}» بلا مسؤول`, r);
    if (!output) issue('warning', `الخطوة «${stepText}» بلا مخرج`, r);
    if (!step.weeks.length && header.weekCols.length) issue('warning', `الخطوة «${stepText}» بلا جدولة زمنية`, r);
    if (followup) {
      issue('info', `عمود المتابعة للخطوة «${stepText}» يحتوي «${followup}» — للمراجعة فقط، ولم يُحتسب إنجازًا`, r);
    }
  }

  // أنشطة بلا خطوات
  for (const a of base.activities) {
    if (a.steps.length === 0) issue('warning', `النشاط «${a.title}» بلا خطوات`, a.row);
  }
  base.activities = base.activities.filter((a) => a.steps.length > 0);
  base.activities.forEach((a, i) => (a.seq = i + 1));

  base.stats = {
    activities: base.activities.length,
    steps: base.activities.reduce((s, a) => s + a.steps.length, 0),
    scheduledSteps: base.activities.reduce((s, a) => s + a.steps.filter((x) => x.weeks.length).length, 0),
  };
  if (base.stats.steps === 0) issue('error', 'لم يتم العثور على أي خطوات في الورقة');
  return base;
}

export async function parseOperationalWorkbook(data: ArrayBuffer | Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
   
  await wb.xlsx.load(data as any);
  const sheets: ParsedSheet[] = [];
  const issues: ImportIssue[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') continue;
    if (ws.rowCount === 0) continue;
    const s = parseSheet(ws);
    if (s.stats.steps === 0 && s.issues.some((i) => i.message.startsWith('لم يتم العثور على صف'))) {
      issues.push({ level: 'info', sheet: s.sheetName, message: 'ورقة لا تحتوي خطة تشغيلية — تم تجاهلها' });
      continue;
    }
    sheets.push(s);
  }
  return { sheets, issues };
}

// ---------------------------------------------------------------------
// مطابقة الورقة مع الإدارة
// ---------------------------------------------------------------------

function deptTokens(s: string): string {
  return normalizeAr(s)
    .replace(/الخطه|التشغيليه|التشغيلي+له|للاداره|لل/g, ' ')
    .replace(/اداره|الاداره/g, ' ')
    .replace(/\bال/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchDepartment(
  hint: string | null,
  sheetName: string,
  departments: { id: string; name: string; short_name?: string | null }[],
): { id: string; confidence: 'high' | 'low' } | null {
  const candidates = [hint, sheetName].filter(Boolean) as string[];
  for (const [i, c] of candidates.entries()) {
    const ct = deptTokens(c);
    if (!ct) continue;
    let best: { id: string; score: number } | null = null;
    for (const d of departments) {
      const names = [d.name, d.short_name].filter(Boolean) as string[];
      for (const n of names) {
        const nt = deptTokens(n);
        if (!nt) continue;
        let score = 0;
        if (ct === nt) score = 3;
        else if (ct.includes(nt) || nt.includes(ct)) score = 2;
        else {
          const cw = new Set(ct.split(' '));
          const overlap = nt.split(' ').filter((w) => w.length > 2 && [...cw].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))));
          if (overlap.length) score = 1;
        }
        if (score && (!best || score > best.score)) best = { id: d.id, score };
      }
    }
    if (best) return { id: best.id, confidence: best.score >= 2 && i === 0 ? 'high' : 'low' };
  }
  return null;
}
