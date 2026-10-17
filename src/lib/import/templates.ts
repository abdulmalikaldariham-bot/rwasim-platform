// =====================================================================
// قوالب Excel القابلة للتنزيل للسنوات القادمة
// =====================================================================
import ExcelJS from 'exceljs';
import { EXEC_COLUMNS } from './executive';

const NAVY = 'FF013047';
const TEAL = 'FF326E7C';
const ORANGE = 'FFF09223';
const LIGHT = 'FFE5F1EE';
const FONT = 'IBM Plex Sans Arabic';
const QUARTER_NAMES = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];

const border: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8CCD1' } },
  bottom: { style: 'thin', color: { argb: 'FFB8CCD1' } },
  left: { style: 'thin', color: { argb: 'FFB8CCD1' } },
  right: { style: 'thin', color: { argb: 'FFB8CCD1' } },
};

function headerStyle(cell: ExcelJS.Cell, color = NAVY) {
  cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  cell.border = border;
}

export async function buildOperationalTemplate(opts: { year: number; quarter: number; departments: string[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'رواسم | منصة الأداء المؤسسي';
  const months = [1, 2, 3].map((i) => (opts.quarter - 1) * 3 + i);

  const guide = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  guide.getColumn(1).width = 110;
  const lines = [
    'قالب الخطة التشغيلية الربعية — رواسم',
    '',
    '1) ورقة لكل إدارة. اكتب اسم الإدارة بين قوسين في عنوان الورقة كما هو موضح.',
    '2) اكتب اسم النشاط في عمود «البرنامج / النشاط» في أول صف من خطواته فقط (يمكن دمج الخلايا).',
    '3) اكتب كل خطوة في صف مستقل مع المسؤول والمخرج.',
    '4) ضع علامة * (أو رقمًا يمثل عدد المرات) في أسابيع التنفيذ المخطط. يمكن أيضًا تلوين الخلية.',
    '5) لا تكتب نسب إنجاز في الملف؛ الإنجاز يُسجل داخل المنصة بعد اعتماد الخطة.',
    '6) أوزان الأنشطة والخطوات تُضبط داخل المنصة بعد الاستيراد (الخطوة الجوهرية 40٪ افتراضيًا).',
  ];
  lines.forEach((l, i) => {
    const c = guide.getCell(i + 1, 1);
    c.value = l;
    c.font = { name: FONT, size: i === 0 ? 14 : 11, bold: i === 0, color: { argb: i === 0 ? NAVY : 'FF333333' } };
    c.alignment = { readingOrder: 'rtl', horizontal: 'right' };
  });

  for (const dept of opts.departments) {
    const ws = wb.addWorksheet(dept.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }] });
    ws.columns = [
      { width: 6 }, { width: 28 }, { width: 40 }, { width: 18 }, { width: 26 }, { width: 12 },
      ...Array(12).fill({ width: 5 }),
    ];
    ws.mergeCells(1, 1, 1, 18);
    const t = ws.getCell(1, 1);
    t.value = `بطاقات الخطة التشغيلية الربع ${QUARTER_NAMES[opts.quarter]} لعام ${opts.year}م (${dept})`;
    t.font = { name: FONT, bold: true, size: 14, color: { argb: NAVY } };
    t.alignment = { horizontal: 'center', readingOrder: 'rtl' };
    ws.getRow(1).height = 28;

    ws.mergeCells(2, 1, 2, 6);
    ws.getCell(2, 1).value = 'البرامج';
    headerStyle(ws.getCell(2, 1), TEAL);
    ws.mergeCells(2, 7, 2, 18);
    ws.getCell(2, 7).value = 'الجدولة الأسبوعية';
    headerStyle(ws.getCell(2, 7), TEAL);

    const heads = ['الرقم', 'البرنامج / النشاط', 'الخطوات التفصيلية', 'المسؤول', 'المخرج', 'المتابعة'];
    heads.forEach((h, i) => {
      ws.mergeCells(3, i + 1, 4, i + 1);
      ws.getCell(3, i + 1).value = h;
      headerStyle(ws.getCell(3, i + 1));
    });
    months.forEach((m, mi) => {
      ws.mergeCells(3, 7 + mi * 4, 3, 10 + mi * 4);
      ws.getCell(3, 7 + mi * 4).value = `شهر${m}`;
      headerStyle(ws.getCell(3, 7 + mi * 4), ORANGE);
      for (let w = 1; w <= 4; w++) {
        const c = ws.getCell(4, 6 + mi * 4 + w);
        c.value = `س${w}`;
        headerStyle(c);
      }
    });
    for (let r = 5; r <= 40; r++) {
      for (let c = 1; c <= 18; c++) {
        const cell = ws.getCell(r, c);
        cell.border = border;
        cell.font = { name: FONT, size: 10 };
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c >= 7 ? 'center' : 'right', readingOrder: 'rtl' };
        if (c === 6) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildExecutiveTemplate(opts: { year: number; departments: string[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'رواسم | منصة الأداء المؤسسي';
  const ws = wb.addWorksheet(`الخطة التنفيذية ${opts.year}`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }] });
  ws.mergeCells(1, 1, 1, EXEC_COLUMNS.length);
  const t = ws.getCell(1, 1);
  t.value = `الخطة التنفيذية السنوية لعام ${opts.year}م — جمعية رواسم`;
  t.font = { name: FONT, bold: true, size: 14, color: { argb: NAVY } };
  t.alignment = { horizontal: 'center', readingOrder: 'rtl' };
  EXEC_COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
    const c = ws.getCell(2, i + 1);
    c.value = col.label;
    headerStyle(c, i < 2 ? TEAL : i >= 10 && i <= 14 ? ORANGE : NAVY);
  });
  ws.getRow(2).height = 42;
  const listValidations: Record<string, string[]> = {
    kpiType: ['عددي', 'نسبة', 'مالي', 'نوعي'],
    direction: ['زيادة', 'انخفاض'],
    frequency: ['شهري', 'ربعي', 'نصف سنوي', 'سنوي'],
    department: opts.departments,
  };
  for (let r = 3; r <= 80; r++) {
    EXEC_COLUMNS.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.border = border;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
      const list = listValidations[col.key];
      if (list && list.length) {
        cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`] };
      }
    });
  }
  const g = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  g.getColumn(1).width = 110;
  [
    'تعليمات قالب الخطة التنفيذية',
    'اكتب المحور والهدف في أول مؤشر يتبعهما، ويمكن تركهما فارغين للمؤشرات التالية تحت الهدف نفسه.',
    'المستهدفات المرحلية تراكمية حتى نهاية الربع (اختيارية). عند غيابها يوزع المستهدف السنوي خطيًا للمؤشرات العددية.',
    'المؤشر النوعي يقاس بدرجة من 0 إلى 100 وفق سلم تقييم تحدده في «طريقة الاحتساب».',
    'اتجاه «انخفاض» يعني أن انخفاض القيمة دليل تحسن (مثل نسبة التسرب).',
  ].forEach((l, i) => {
    const c = g.getCell(i + 1, 1);
    c.value = l;
    c.font = { name: FONT, size: i ? 11 : 14, bold: !i, color: { argb: i ? 'FF333333' : NAVY } };
    c.alignment = { readingOrder: 'rtl', horizontal: 'right', wrapText: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
