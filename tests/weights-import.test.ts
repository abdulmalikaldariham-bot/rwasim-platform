import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  apportion,
  classifyActivity,
  detectCoreStep,
  suggestActivityWeightsEqual,
  suggestCycleSubsteps,
  suggestStepWeights,
} from '../src/lib/engine/weights';
import { evaluateKpi } from '../src/lib/engine/kpi';
import { matchDepartment, parseOperationalWorkbook, parseTitle } from '../src/lib/import/operational';
import { diffPlan } from '../src/lib/import/diff';
import { parseExecutiveWorkbook } from '../src/lib/import/executive';
import { buildExecutiveTemplate, buildOperationalTemplate } from '../src/lib/import/templates';

const sum = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;
const DEPTS = [
  { id: 'EXEC', name: 'الإدارة التنفيذية', short_name: 'التنفيذية' },
  { id: 'PROJ', name: 'إدارة المشاريع', short_name: 'المشاريع' },
  { id: 'SUPP', name: 'إدارة الخدمات المساندة', short_name: 'المساندة' },
  { id: 'COMM', name: 'إدارة الاتصال المؤسسي', short_name: 'الاتصال المؤسسي' },
  { id: 'TMKN', name: 'إدارة تمكين', short_name: 'تمكين' },
];

describe('اقتراح الأوزان', () => {
  it('قالب المشروع 10/10/10/20/40/10', () => {
    const titles = ['انضاج المشروع', 'تسليم وثيقة المشروع', 'اعتماد وثيقة المشروع', 'اعداد المشروع', 'تنفيذ المشروع', 'اغلاق المشروع'];
    const s = suggestStepWeights('project', titles.map((title) => ({ title })));
    expect(s.method).toBe('project_template');
    expect(s.weights).toEqual([10, 10, 10, 20, 40, 10]);
    expect(s.coreIndex).toBe(4);
  });
  it('الخطوة الجوهرية 40٪ والباقي بالتساوي', () => {
    const s = suggestStepWeights('planning', [{ title: 'اجتماع' }, { title: 'كتابة الخطة' }, { title: 'مراجعة' }, { title: 'اعتماد' }]);
    expect(s.weights[1]).toBe(40);
    expect(s.weights).toEqual([20, 40, 20, 20]);
    expect(sum(s.weights)).toBe(100);
  });
  it('أعمال التخطيط: الجوهرية هي الكتابة الفعلية', () => {
    expect(detectCoreStep('planning', [{ title: 'اجتماع تحليل' }, { title: 'كتابة الخطة التنفيذية' }, { title: 'اعتماد الخطة' }])).toBe(1);
  });
  it('«التنفيذي» لا تعد خطوة تنفيذ', () => {
    expect(detectCoreStep('construction', [{ title: 'عرض التصور على المدير التنفيذي' }, { title: 'البدء في أعمال تأسيس الفريق' }])).toBe(1);
  });
  it('مجموع الأوزان 100 دائمًا', () => {
    for (let n = 1; n <= 13; n++) {
      const s = suggestStepWeights('other', Array.from({ length: n }, (_, i) => ({ title: 'خطوة ' + i })));
      expect(sum(s.weights)).toBe(100);
      expect(sum(suggestActivityWeightsEqual(n))).toBe(100);
      expect(sum(apportion(Array.from({ length: n }, (_, i) => i + 1)))).toBe(100);
    }
  });
  it('التصنيف', () => {
    expect(classifyActivity('المشتريات الدورية', [])).toBe('recurring');
    expect(classifyActivity('انشاء المستودع', [])).toBe('construction');
    expect(classifyActivity('التخطيط لعام 2027', [])).toBe('planning');
  });
  it('دورات شهرية للأعمال المتكررة', () => {
    const c = suggestCycleSubsteps([4, 8, 12], 4);
    expect(c.map((x) => x.title)).toEqual(['دورة شهر أكتوبر', 'دورة شهر نوفمبر', 'دورة شهر ديسمبر']);
    expect(sum(c.map((x) => x.weight))).toBe(100);
    expect(suggestCycleSubsteps([1, 2], 4)).toEqual([]);
  });
});

describe('استيراد ملف الربع الرابع 2026 المرفق', async () => {
  const wb = await parseOperationalWorkbook(readFileSync(path.join(__dirname, 'fixtures/q4-2026-plan.xlsx')));

  it('يتعرف على الإدارات الأربع', () => {
    expect(wb.sheets).toHaveLength(4);
    const ids = wb.sheets.map((s) => matchDepartment(s.departmentHint, s.sheetName, DEPTS)?.id);
    expect(ids).toEqual(['EXEC', 'PROJ', 'SUPP', 'COMM']);
  });
  it('السنة والربع والأشهر', () => {
    for (const s of wb.sheets) {
      expect(s.year).toBe(2026);
      expect(s.quarter).toBe(4);
      expect(s.months).toEqual([10, 11, 12]);
    }
  });
  it('الأنشطة والخطوات بالتسلسل', () => {
    const [exec, proj, supp, comm] = wb.sheets;
    expect(exec.stats).toEqual({ activities: 5, steps: 16, scheduledSteps: 16 });
    expect(proj.stats).toEqual({ activities: 4, steps: 19, scheduledSteps: 19 });
    expect(supp.stats).toEqual({ activities: 7, steps: 20, scheduledSteps: 20 });
    expect(comm.stats).toEqual({ activities: 13, steps: 53, scheduledSteps: 51 });
    expect(exec.activities[0].title).toBe('التخطيط لعام ٢٠٢٧م');
    expect(exec.activities[0].steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(proj.activities[0].steps[4]).toMatchObject({ title: 'تنفيذ المشروع', responsible: 'فريق الأشبال', output: 'تقرير تنفيذ المشروع' });
  });
  it('الجدولة بالتلوين (التنفيذية) وبالعلامات (الاتصال)', () => {
    const [exec, , , comm] = wb.sheets;
    expect(exec.scheduleMode).toBe('fill');
    expect(comm.scheduleMode).toBe('marks');
    // «اجتماع تحليل واقع الجمعية» ملون في K,L,M = شهر 11 س1..س3 = أسابيع 5,6,7
    expect(exec.activities[0].steps[1].weeks).toEqual([5, 6, 7]);
    // «كتابة رسائل الشهر» قيم رقمية 2,4,4,4
    const mail = comm.activities.find((a) => a.title === 'البريد')!;
    expect(mail.steps[0].weeks).toEqual([1, 3, 7, 11]);
    expect(mail.steps[0].intensities).toEqual({ 1: 2, 3: 4, 7: 4, 11: 4 });
  });
  it('الخطوة الممتدة سجل واحد', () => {
    const supp = wb.sheets[2];
    const s = supp.activities.find((a) => a.title === 'إدارة الحجوزات')!.steps[1];
    expect(s.weeks).toHaveLength(11);
    expect(supp.activities.flatMap((a) => a.steps).filter((x) => x.title === s.title)).toHaveLength(1);
  });
  it('يبلغ عن الناقص ولا يحتسب «تم» إنجازًا', () => {
    const [exec, proj, supp, comm] = wb.sheets;
    expect(exec.issues.some((i) => i.message.includes('النشاط رقم 6 فارغ'))).toBe(true);
    expect(proj.issues.filter((i) => /النشاط رقم [56] فارغ/.test(i.message))).toHaveLength(2);
    expect(supp.issues.filter((i) => i.message.includes('بلا مخرج'))).toHaveLength(3);
    expect(comm.issues.filter((i) => i.message.includes('بلا جدولة'))).toHaveLength(2);
    const done = exec.activities[2].steps[0];
    expect(done.followup).toBe('تم');
    expect(Object.keys(done)).not.toContain('progress');
  });
  it('لا يختلق مسؤوليات', () => {
    const all = wb.sheets.flatMap((s) => s.activities.flatMap((a) => a.steps));
    const withoutResp = all.filter((s) => !s.responsible);
    expect(withoutResp).toHaveLength(0); // جميعها موجودة في الملف
  });
});

describe('العنوان', () => {
  it('يستخرج الإدارة والربع والسنة', () => {
    expect(parseTitle('بطاقات الخطة التشغيلية الربع الرابع لعام ٢٠٢٦م ( إدارة المشاريع ) ')).toEqual({ year: 2026, quarter: 4, department: 'إدارة المشاريع' });
  });
});

describe('إعادة الاستيراد (المقارنة)', () => {
  it('لا يكرر ولا يحذف ما فيه إنجاز', () => {
    const existing = [
      {
        id: 'A1',
        title: 'مشوار الاشبال',
        steps: [
          { id: 'S1', title: 'انضاج المشروع', responsible_text: 'فريق', output: 'وثيقة', weeks: [1], progress: 100, status: 'completed' },
          { id: 'S2', title: 'تنفيذ المشروع', responsible_text: 'فريق', output: 'تقرير', weeks: [3, 4], progress: 0, status: 'not_started' },
        ],
      },
      { id: 'A2', title: 'نشاط قديم', steps: [{ id: 'S9', title: 'خطوة', responsible_text: null, output: null, weeks: [], progress: 100, status: 'completed' }] },
    ];
    const parsed = [
      {
        seq: 1,
        row: 5,
        number: '1',
        title: 'مشوار الأشبال',
        steps: [
          { seq: 1, row: 5, title: 'انضاج المشروع', responsible: 'فريق', output: 'وثيقة', followup: null, weeks: [1], intensities: {}, scheduleSource: 'fill' as const },
          { seq: 2, row: 6, title: 'تنفيذ المشروع', responsible: 'فريق الأشبال', output: 'تقرير', weeks: [4, 5], followup: null, intensities: {}, scheduleSource: 'fill' as const },
          { seq: 3, row: 7, title: 'اغلاق المشروع', responsible: 'فريق', output: 'تقرير إغلاق', weeks: [6], followup: null, intensities: {}, scheduleSource: 'fill' as const },
        ],
      },
    ];
    const d = diffPlan(existing, parsed);
    expect(d.activities[0].kind).toBe('matched'); // «الاشبال» = «الأشبال» بعد التطبيع
    expect(d.summary.addedActivities).toBe(0);
    expect(d.summary.addedSteps).toBe(1);
    expect(d.summary.changedSteps).toBe(1);
    expect(d.summary.removedActivities).toBe(1);
    expect(d.summary.protectedItems).toBe(1); // خطوة النشاط القديم فيها إنجاز
    const changed = d.activities[0].steps.find((s) => s.kind === 'changed')!;
    expect(changed.changes.map((c) => c.field).sort()).toEqual(['responsible', 'weeks']);
  });
});

describe('القوالب', () => {
  it('قالب الخطة التشغيلية يعاد استيراده', async () => {
    const buf = await buildOperationalTemplate({ year: 2027, quarter: 1, departments: ['إدارة تمكين'] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('إدارة تمكين')!;
    ws.getCell('A5').value = 1;
    ws.getCell('B5').value = 'برنامج تمكين القادة';
    ws.getCell('C5').value = 'تصميم البرنامج';
    ws.getCell('D5').value = 'مدير تمكين';
    ws.getCell('E5').value = 'وثيقة البرنامج';
    ws.getCell('G5').value = '*';
    ws.getCell('C6').value = 'تنفيذ البرنامج';
    ws.getCell('D6').value = 'فريق تمكين';
    ws.getCell('E6').value = 'تقرير التنفيذ';
    ws.getCell('K6').value = '*';
    ws.getCell('L6').value = '*';
    const out = await wb.xlsx.writeBuffer();
    const parsed = await parseOperationalWorkbook(out as ArrayBuffer);
    expect(parsed.sheets).toHaveLength(1);
    const s = parsed.sheets[0];
    expect(s.year).toBe(2027);
    expect(s.quarter).toBe(1);
    expect(matchDepartment(s.departmentHint, s.sheetName, DEPTS)?.id).toBe('TMKN');
    expect(s.activities[0].steps.map((x) => x.weeks)).toEqual([[1], [5, 6]]);
  });
  it('قالب الخطة التنفيذية يعاد استيراده', async () => {
    const buf = await buildExecutiveTemplate({ year: 2027, departments: DEPTS.map((d) => d.name) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const row = ws.getRow(3);
    const vals = ['تمكين الطفل', 'رفع جودة البرامج', 'K1', 'عدد المستفيدين', 'عدد الأطفال المستفيدين', 'مجموع المسجلين', 'طفل', 'عددي', 'زيادة', 100, 400, 100, 200, 300, 400, 'إدارة المشاريع', 'ربعي', 'نظام التسجيل'];
    vals.forEach((v, i) => (row.getCell(i + 1).value = v));
    ws.getRow(4).getCell(4).value = 'نسبة التسرب';
    ws.getRow(4).getCell(8).value = 'نسبة';
    ws.getRow(4).getCell(9).value = 'انخفاض';
    ws.getRow(4).getCell(10).value = 20;
    ws.getRow(4).getCell(11).value = 10;
    ws.getRow(4).getCell(16).value = 'إدارة المشاريع';
    const out = await wb.xlsx.writeBuffer();
    const p = await parseExecutiveWorkbook(out as ArrayBuffer);
    expect(p.kpis).toHaveLength(2);
    expect(p.axes).toHaveLength(1);
    expect(p.axes[0].goals[0].kpis).toHaveLength(2);
    expect(p.kpis[0]).toMatchObject({ code: 'K1', annualTarget: 400, baseline: 100, periodTargets: { 1: 100, 2: 200, 3: 300, 4: 400 } });
    expect(p.kpis[1]).toMatchObject({ kpiType: 'percentage', direction: 'decrease' });
  });
});

describe('مؤشرات الأداء', () => {
  it('الزيادة مع خط أساس', () => {
    const e = evaluateKpi({ kpiType: 'numeric', direction: 'increase', baseline: 100, annualTarget: 400, periodTargets: {}, actual: 250 }, 2);
    expect(e.achievement).toBe(50);
    expect(e.expected).toBe(250);
    expect(e.status).toBe('on_track');
  });
  it('الانخفاض دليل التحسن', () => {
    const e = evaluateKpi({ kpiType: 'percentage', direction: 'decrease', baseline: 20, annualTarget: 10, periodTargets: {}, actual: 12 }, 4);
    expect(e.achievement).toBe(80);
    expect(e.status).toBe('at_risk');
  });
  it('لا بيانات', () => {
    expect(evaluateKpi({ kpiType: 'numeric', direction: 'increase', baseline: null, annualTarget: 10, periodTargets: {}, actual: null }, 1).status).toBe('no_data');
  });
  it('تحقق المستهدف', () => {
    expect(evaluateKpi({ kpiType: 'financial', direction: 'increase', baseline: null, annualTarget: 1000, periodTargets: { 1: 200 }, actual: 1200 }, 1).status).toBe('achieved');
  });
});
