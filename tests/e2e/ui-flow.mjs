/**
 * اختبار واجهة شامل (متصفح حقيقي) على بيئة محلية مزروعة بالبيانات التجريبية.
 *   BASE=http://localhost:3000 node tests/e2e/ui-flow.mjs <shots-dir>
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? '/tmp';
const PW = 'Demo-Rawasim-2026';
const results = [];
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function session(email, width = 1440) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900 });
  page.on('pageerror', (e) => results.push({ name: `JS error (${email})`, ok: false, detail: e.message }));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')]);
  return { page, ctx };
}
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message.slice(0, 300) });
  }
}
const clickText = async (page, text, sel = 'button') => {
  const ok = await page.evaluate(
    (t, s) => {
      const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t) && !b.disabled);
      if (el) el.click();
      return !!el;
    },
    text,
    sel,
  );
  if (!ok) throw new Error(`لم يُعثر على «${text}»`);
};
const waitText = (page, text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `e2e_${name}.png`), fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) المدير التنفيذي يعتمد خطة الاتصال المؤسسي
const ed = await session('ed@demo.rawasim.local');
await step('اعتماد خطة مرفوعة من المدير التنفيذي', async () => {
  await ed.page.goto(BASE + '/executive', { waitUntil: 'networkidle0' });
  const href = await ed.page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('إدارة الاتصال المؤسسي — ر4'))?.getAttribute('href'));
  if (!href) throw new Error('الخطة المرفوعة غير ظاهرة في الاعتمادات');
  await ed.page.goto(BASE + href, { waitUntil: 'networkidle0' });
  await clickText(ed.page, 'اعتماد الخطة');
  await waitText(ed.page, 'معتمدة');
  return href;
});

// 2) الموظف المفوض يرى مهامه فقط ويكملها بنقرة
const emp = await session('rashid@demo.rawasim.local', 390);
await step('الموظف: شاشة مهامي على الجوال وإكمال مهمة مع المخرج المتحقق', async () => {
  await emp.page.goto(BASE + '/my-tasks', { waitUntil: 'networkidle0' });
  await shot(emp.page, 'employee_mytasks_mobile');
  const before = await emp.page.$$eval('article', (a) => a.length);
  if (!before) throw new Error('لا توجد مهام ظاهرة');
  // تسجيل الإنجاز من صفحة المهمة: المخرج المتحقق مطلوب قبل الإكمال
  await clickText(emp.page, 'تسجيل الإنجاز', 'a');
  await emp.page.waitForFunction(() => location.pathname.startsWith('/tasks/'), { timeout: 15000 });
  await emp.page.waitForSelector('[aria-label="الحالة"]');
  await clickText(emp.page, 'مكتملة', '[aria-label="الحالة"] button');
  await emp.page.waitForSelector('#out-c');
  await emp.page.type('#out-c', 'نُشرت المسودة الأولى واعتمدها المدير');
  await clickText(emp.page, 'حفظ التحديث');
  await sleep(2500);
  await shot(emp.page, 'employee_task_page_mobile');
  await emp.page.goto(BASE + '/my-tasks?view=done', { waitUntil: 'networkidle0' });
  const done = await emp.page.$$eval('article', (a) => a.length);
  if (done < 1) throw new Error('لم تظهر المهمة في المنجزة');
  return `${before} مهام، ${done} منجزة`;
});
await step('الموظف: لا يصل لمركز المتابعة التنفيذية ولا للخطط', async () => {
  for (const u of ['/executive', '/plans', '/settings', '/reports']) {
    await emp.page.goto(BASE + u, { waitUntil: 'networkidle0' });
    await emp.page.waitForFunction((x) => !location.pathname.startsWith(x), { timeout: 10000 }, u).catch(() => {
      throw new Error('وصل إلى ' + u);
    });
  }
});

// 3) مدير تمكين ينشئ خطة يدوية ويضبط أوزانها ويرفعها
const tm = await session('tmkn@demo.rawasim.local');
await step('مدير إدارة تمكين: إنشاء خطة يدوية، خطوات، أوزان، رفع', async () => {
  const p = tm.page;
  await p.goto(BASE + '/plans', { waitUntil: 'networkidle0' });
  await clickText(p, 'إنشاء يدوي');
  await sleep(400);
  await clickText(p, 'إنشاء المسودة');
  await p.waitForFunction(() => /\/plans\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
  const planUrl = p.url();
  await p.type('input[aria-label="نشاط جديد"]', 'برنامج تمكين القادة الصغار');
  await clickText(p, 'إضافة نشاط');
  await waitText(p, 'برنامج تمكين القادة الصغار');
  for (const [t, r, o, weeks] of [
    ['تصميم البرنامج', 'منسق تمكين', 'وثيقة البرنامج', ['س1']],
    ['تنفيذ البرنامج', 'فريق تمكين', 'تقرير التنفيذ', ['س2', 'س3']],
    ['تقييم البرنامج', 'منسق تمكين', 'تقرير التقييم', ['س4']],
  ]) {
    await clickText(p, 'مهمة');
    await p.waitForSelector('#st');
    await p.type('#st', t);
    await p.type('#sr', r);
    await p.type('#so', o);
    for (const w of weeks) await clickText(p, w);
    await clickText(p, 'حفظ', '[role=dialog] button');
    await waitText(p, t);
    await sleep(500);
  }
  await p.goto(planUrl + '/weights', { waitUntil: 'networkidle0' });
  // إدارة الأوزان: شاشة واحدة — وزن النشاط مباشرة ثم التوزيع المقترح لمهامه (الجوهرية 40٪)
  await p.$eval('input[aria-label="وزن برنامج تمكين القادة الصغار"]', (el) => el.focus());
  await p.keyboard.down('Control');
  await p.keyboard.press('A');
  await p.keyboard.up('Control');
  await p.keyboard.type('100');
  await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('توزيع مقترح')).at(-1)?.click());
  await sleep(300);
  await shot(p, 'weights_one_screen');
  const blocked = await p.evaluate(() => document.body.innerText.includes('لا يمكن الحفظ قبل إكمال التوزيع'));
  if (blocked) throw new Error('التوزيع ما زال ناقصًا');
  await clickText(p, 'حفظ ورفع للاعتماد');
  await p.waitForFunction(() => !location.pathname.endsWith('/weights'), { timeout: 20000 });
  await waitText(p, 'بانتظار الاعتماد');
  return planUrl;
});

// 4) المدير التنفيذي يعتمد خطة تمكين — الجمعية تصبح قابلة للاحتساب
await step('اعتماد خطة تمكين وظهور الإنجاز الكلي للجمعية', async () => {
  await ed.page.goto(BASE + '/executive', { waitUntil: 'networkidle0' });
  const href = await ed.page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('إدارة تمكين — ر4'))?.getAttribute('href'));
  if (!href) throw new Error('خطة تمكين غير ظاهرة');
  await ed.page.goto(BASE + href, { waitUntil: 'networkidle0' });
  await clickText(ed.page, 'اعتماد الخطة');
  await waitText(ed.page, 'معتمدة');
  await ed.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
  const txt = await ed.page.evaluate(() => document.body.innerText);
  if (txt.includes('غير قابل للاحتساب')) throw new Error('ما زالت غير قابلة للاحتساب');
  await shot(ed.page, 'dashboard_complete');
});

// 5) التعمق: الجمعية ← الإدارة ← النشاط
await step('التعمق من اللوحة إلى الإدارة ثم النشاط', async () => {
  await ed.page.click('ol a[href*="/dashboard/department/"]');
  await ed.page.waitForFunction(() => location.pathname.includes('/dashboard/department/'));
  await ed.page.waitForSelector('a[href^="/activities/"]');
  await ed.page.click('a[href^="/activities/"]');
  await ed.page.waitForFunction(() => location.pathname.startsWith('/activities/'));
  await waitText(ed.page, 'المهام التنفيذية');
});

// 6) مجلس الإدارة: قراءة فقط
const board = await session('board@demo.rawasim.local');
await step('مجلس الإدارة: يرى اللوحة دون مركز المتابعة ودون أزرار التحديث', async () => {
  const p = board.page;
  await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
  const nav = await p.evaluate(() => document.querySelector('aside')?.innerText ?? '');
  if (nav.includes('مركز المتابعة')) throw new Error('يظهر مركز المتابعة');
  const body = await p.evaluate(() => document.body.innerText);
  if (body.includes('ما الذي يحتاج إلى تدخلك')) throw new Error('يظهر قسم التدخل في اللوحة العامة');
  await p.click('ol a[href*="/dashboard/department/"]');
  await p.waitForSelector('a[href^="/activities/"]');
  await p.click('a[href^="/activities/"]');
  await waitText(p, 'المهام التنفيذية');
  const hasUpdate = await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('تم الإنجاز') || b.textContent.trim() === 'تحديث'));
  if (hasUpdate) throw new Error('أزرار التحديث ظاهرة للمجلس');
});

// 7) التقارير: إصدار ربعي، اعتماد، PDF وExcel
await step('إصدار تقرير ربعي واعتماده وتنزيل PDF وExcel', async () => {
  const p = ed.page;
  await p.goto(BASE + '/reports', { waitUntil: 'networkidle0' });
  await clickText(p, 'إصدار التقرير');
  await p.waitForFunction(() => /\/reports\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 30000 });
  const id = p.url().split('/').pop();
  await shot(p, 'report_view');
  const pdf = await p.evaluate(async (u) => {
    const r = await fetch(u);
    const b = await r.arrayBuffer();
    return { status: r.status, type: r.headers.get('content-type'), size: b.byteLength };
  }, `/api/reports/${id}/pdf`);
  if (pdf.status !== 200 || !pdf.type.includes('pdf') || pdf.size < 10000) throw new Error('PDF: ' + JSON.stringify(pdf));
  const xl = await p.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, size: (await r.arrayBuffer()).byteLength };
  }, `/api/reports/${id}/xlsx`);
  if (xl.status !== 200 || xl.size < 3000) throw new Error('Excel: ' + JSON.stringify(xl));
  await p.type('#dc', 'أداء الربع جيد مع تأخر في المشاريع؛ نوصي بتسريع بادية رواسم.');
  p.once('dialog', (d) => d.accept());
  await clickText(p, 'اعتماد التقرير');
  await waitText(p, 'تقرير معتمد', 30000);
  return `PDF ${Math.round(pdf.size / 1024)}KB، Excel ${Math.round(xl.size / 1024)}KB`;
});

// 9) إنشاء سنة جديدة واستيراد الملف المرفق عبر المعالج
await step('إنشاء سنة 2027 من الإعدادات', async () => {
  const p = ed.page;
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle0' });
  await p.$eval('#ny', (el) => (el.value = ''));
  await p.type('#ny', '2027');
  await clickText(p, 'إنشاء السنة');
  await waitText(p, '2027م');
});
await step('معالج الاستيراد: ملف Excel المرفق إلى الربع الأول 2027 (4 إدارات)', async () => {
  const p = ed.page;
  await p.goto(BASE + '/plans/import?year=2027&q=1', { waitUntil: 'networkidle0' });
  await clickText(p, 'التالي');
  const input = await p.waitForSelector('#xl');
  await input.uploadFile(path.resolve('tests/fixtures/q4-2026-plan.xlsx'));
  await waitText(p, 'مطابقة الأوراق');
  await p.waitForFunction(() => document.body.innerText.includes('أوراق خطط'), { timeout: 30000 });
  await shot(p, 'import_mapping');
  const txt = await p.evaluate(() => document.body.innerText);
  if (!txt.includes('تنبيه الفترة')) throw new Error('لم يظهر تنبيه اختلاف الفترة');
  await clickText(p, 'مراجعة المحتوى');
  await waitText(p, 'ملاحظات التحليل');
  await shot(p, 'import_review');
  await clickText(p, 'التالي');
  await clickText(p, 'كمسودات');
  await waitText(p, 'أنشئت 4 خطط', 60000);
  return 'أنشئت 4 مسودات';
});
await step('إعادة الاستيراد على خطة معتمدة: مقارنة دون تكرار', async () => {
  const p = ed.page;
  await p.goto(BASE + '/plans?year=2026', { waitUntil: 'networkidle0' });
  const href = await p.evaluate(() => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes('إدارة المشاريع'))?.querySelector('a')?.getAttribute('href'));
  await p.goto(BASE + href + '/reimport', { waitUntil: 'networkidle0' });
  const input = await p.waitForSelector('input[type=file]');
  await input.uploadFile(path.resolve('tests/fixtures/q4-2026-plan.xlsx'));
  await waitText(p, 'الورقة المطابقة', 30000);
  const t = await p.evaluate(() => document.body.innerText);
  if (!t.includes('0 نشاط جديد') || !t.includes('0 خطوة جديدة')) throw new Error('ظهرت إضافات لملف مطابق');
  await shot(p, 'reimport_same');
});
await step('الخطة التنفيذية 2027 من قالب Excel واعتمادها', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const p = ed.page;
  const buf = await p.evaluate(async () => {
    const r = await fetch('/api/templates/executive?year=2027');
    return Array.from(new Uint8Array(await r.arrayBuffer()));
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf));
  const ws = wb.worksheets[0];
  const rows = [
    ['تمكين الطفل', 'رفع جودة البرامج التربوية', 'K1', 'عدد الأطفال المستفيدين', 'المسجلون في برامج الجمعية', 'مجموع المسجلين', 'طفل', 'عددي', 'زيادة', 150, 400, 100, 200, 300, 400, 'إدارة المشاريع', 'ربعي', 'نظام التسجيل'],
    [null, null, 'K2', 'نسبة رضا أولياء الأمور', null, 'استبانة', '٪', 'نسبة', 'زيادة', 70, 85, null, null, null, null, 'إدارة الاتصال المؤسسي', 'نصف سنوي', 'الاستبانات'],
    ['الاستدامة المؤسسية', 'تنمية الموارد', 'K3', 'إيرادات المنح', null, null, 'ريال', 'مالي', 'زيادة', null, 500000, null, null, null, null, 'إدارة الاتصال المؤسسي', 'ربعي', 'السجلات المالية'],
  ];
  rows.forEach((r, i) => r.forEach((v, j) => v !== null && (ws.getRow(3 + i).getCell(j + 1).value = v)));
  const file = path.join(OUT, 'exec-2027.xlsx');
  await wb.xlsx.writeFile(file);
  await p.goto(BASE + '/executive-plan?year=2027', { waitUntil: 'networkidle0' });
  const inputs = await p.$$('input[type=file]');
  await inputs[inputs.length - 1].uploadFile(file);
  await waitText(p, 'مؤشرًا في', 30000);
  await sleep(1500);
  await clickText(p, 'استيراد إلى خطة 2027');
  await waitText(p, 'عدد الأطفال المستفيدين', 30000);
  await clickText(p, 'اعتماد الخطة التنفيذية');
  await waitText(p, 'معتمدة');
  await shot(p, 'exec_plan');
});

// 8) لقطات الجوال والوضع الداكن
await step('اللوحة على الجوال وفي الوضع الداكن', async () => {
  const m = await session('ed@demo.rawasim.local', 390);
  await m.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
  await shot(m.page, 'dashboard_mobile');
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('تمرير أفقي على الجوال');
  await m.page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await m.page.setViewport({ width: 1440, height: 900 });
  await m.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
  await shot(m.page, 'dashboard_dark');
});

await browser.close();
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ناجحة`);
process.exit(failed ? 1 : 0);
