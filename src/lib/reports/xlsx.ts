import 'server-only';
import ExcelJS from 'exceljs';
import type { ReportSnapshot } from './build';
import { DATA_STATE, KPI_STATUS, MONTHS, QUARTER_LABEL } from '../labels';

const NAVY = 'FF013047';
const FONT = 'IBM Plex Sans Arabic';

function sheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number | null)[][], widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] ?? 18 }));
  ws.getRow(1).eachCell((c) => {
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });
  ws.getRow(1).height = 24;
  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell((c) => {
      c.font = { name: FONT, size: 10 };
      c.alignment = { vertical: 'top', wrapText: true, readingOrder: 'rtl' };
    });
  }
  return ws;
}

export async function reportToXlsx(snap: ReportSnapshot, title: string, comment: string | null, status: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'رواسم | منصة الأداء المؤسسي';
  const o = snap.operational;
  const s = sheet(
    wb,
    'الملخص',
    ['البند', 'القيمة'],
    [
      ['التقرير', title],
      ['الفترة', snap.meta.periodLabel],
      ['النطاق', snap.meta.departmentName ?? 'الجمعية كاملة'],
      ['الحالة', status === 'approved' ? 'معتمد' : 'مسودة'],
      ['البيانات حتى', snap.meta.asOf],
      ['الإنجاز التشغيلي', o.computable && o.progress !== null ? o.progress / 100 : 'غير قابل للاحتساب'],
      ['المؤشر الجزئي', o.partialProgress === null ? null : o.partialProgress / 100],
      ['المخطط حتى التاريخ', o.planned === null ? null : o.planned / 100],
      ['إدارات بلا خطة معتمدة', o.missingDepartments.join('، ') || '—'],
      ['تعليق المدير التنفيذي', comment ?? '—'],
    ],
    [28, 60],
  );
  [6, 7, 8].forEach((r) => (s.getCell(r + 1, 2).numFmt = '0.0%'));
  const d = sheet(
    wb,
    'الإدارات',
    ['الإدارة', 'الإنجاز', 'المخطط', 'المشاريع والأنشطة', 'المكتملة', 'المتأخرة', 'المتعثرة', 'المهام التنفيذية', 'المهام المكتملة', 'المهام المتأخرة', 'حالة البيانات'],
    o.departments.map((x) => [x.name, x.progress === null ? null : x.progress / 100, x.planned === null ? null : x.planned / 100, x.activities, x.completed, x.late, x.stalled, x.steps ?? null, x.stepsCompleted ?? null, x.stepsLate ?? null, DATA_STATE[x.dataState]]),
    [26, 12, 12, 14, 10, 10, 10, 14, 12, 12, 18],
  );
  d.getColumn(2).numFmt = '0.0%';
  d.getColumn(3).numFmt = '0.0%';
  if (o.quarters) sheet(wb, 'الأرباع', ['الربع', 'الإنجاز', 'ملاحظة'], o.quarters.map((q) => [QUARTER_LABEL[q.quarter], q.hasPlans ? (q.computable ? q.progress : q.partial) : null, !q.hasPlans ? 'لا توجد خطط' : q.computable ? 'مكتمل' : 'جزئي']), [16, 12, 16]);
  if (o.months) sheet(wb, 'الأشهر', ['الشهر', 'مجدولة', 'منجزة', 'متأخرة'], o.months.map((m) => [MONTHS[m.month], m.scheduled, m.done, m.late]), [16, 12, 12, 12]);
  sheet(wb, 'المنجزات', ['المهمة المنجزة', 'المشروع/النشاط', 'الإدارة', 'التاريخ', 'المخرج المتحقق'], snap.achievements.map((a) => [a.step, a.activity, a.department, a.date, a.output ?? null]), [40, 34, 22, 14, 40]);
  sheet(wb, 'المتأخرات', ['المهمة', 'المشروع/النشاط', 'الإدارة', 'المسؤول', 'الموعد', 'أيام التأخر'], snap.lateItems.map((a) => [a.step, a.activity, a.department, a.responsible, a.dueDate, a.daysLate]), [40, 34, 22, 22, 14, 12]);
  sheet(
    wb,
    'المؤشرات',
    ['المحور', 'الهدف', 'المؤشر', 'الإدارة', 'المستهدف', 'المتحقق', 'الوحدة', 'نسبة التحقق', 'الحالة'],
    snap.kpis.map((k) => [k.axis, k.goal, k.name, k.department, k.target, k.actual, k.unit, k.achievement === null ? null : k.achievement / 100, KPI_STATUS[k.status]]),
    [20, 26, 30, 18, 12, 12, 10, 12, 14],
  ).getColumn(8).numFmt = '0.0%';
  sheet(wb, 'الانحرافات', ['البند'], [...snap.deviations.map((x) => [x]), ...snap.challenges.map((c) => [`${c.title} (${c.status === 'resolved' ? 'عولج' : 'قائم'})`])], [100]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
