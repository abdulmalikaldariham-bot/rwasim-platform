/**
 * اختبار واجهة للإصدار الثاني (متصفح حقيقي) — السيناريوهات الـ21 من أمر التطوير.
 * يعمل على بيئة محلية مزروعة بالبيانات التجريبية (seed-demo) بعد تشغيل ui-flow.mjs أو قبله.
 *
 *   BASE=http://localhost:3000 NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tests/e2e/v2-flow.mjs <shots-dir>
 *
 * مفتاح الخدمة يُستخدم هنا للقراءة فقط (معرفة المعرّفات والتحقق من النتائج)، وكل الإجراءات تتم عبر الواجهة.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? '/tmp';
const PW = 'Demo-Rawasim-2026';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `v2_${name}.png`), fullPage: full });
const waitText = (page, text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
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
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message).slice(0, 300) });
  }
}
async function session(email, { width = 1440, height = 900, password = PW } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on('pageerror', (e) => results.push({ name: `JS error (${email})`, ok: false, detail: e.message }));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')]);
  return { page, ctx };
}
const anonPage = async (width = 1920, height = 1080) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on('pageerror', (e) => results.push({ name: 'JS error (زائر)', ok: false, detail: e.message }));
  return page;
};

// ---------- التهيئة: معرفات من البيانات التجريبية ----------
const { data: depts } = await db.from('departments').select('id,code');
const D = Object.fromEntries(depts.map((d) => [d.code, d.id]));
const { data: commPlan } = await db.from('op_plans').select('id,status').eq('department_id', D.COMM).eq('year', 2026).eq('quarter', 4).single();
const { data: rashid } = await db.from('profiles').select('id,full_name').eq('email', 'rashid@demo.rawasim.local').single();

const ed = await session('ed@demo.rawasim.local');
const mgr = await session('comm@demo.rawasim.local');

await step('تهيئة: اعتماد خطة الاتصال المؤسسي إن لم تكن معتمدة', async () => {
  if (commPlan.status === 'approved') return 'معتمدة مسبقًا';
  await ed.page.goto(`${BASE}/plans/${commPlan.id}`, { waitUntil: 'networkidle0' });
  await clickText(ed.page, 'اعتماد الخطة');
  await waitText(ed.page, 'معتمدة');
});

// مهام لم تبدأ في خطة الاتصال، دون مكلفين
const { data: freeSteps } = await db
  .from('steps')
  .select('id,title,status,step_assignees(user_id),substeps(id)')
  .eq('plan_id', commPlan.id)
  .eq('status', 'not_started')
  .order('seq')
  .limit(40);
const pool = freeSteps.filter((s) => s.step_assignees.length === 0 && s.substeps.length === 0);
const [T1, T2, T3, T4, T5] = pool;

// ---------- 17/18: مستخدم جديد بكلمة مؤقتة، تعيين كلمة مرور، ثم تغييرها ----------
const stamp = Date.now() % 1e6;
const newEmail = `noura${stamp}@demo.rawasim.local`;
let tempPw = '';
await step('17. إنشاء مستخدم جديد (اسم، بريد، إدارة، دور) بكلمة مرور مؤقتة فريدة', async () => {
  const p = ed.page;
  await p.goto(BASE + '/settings/users', { waitUntil: 'networkidle0' });
  await clickText(p, 'مستخدم جديد');
  await p.waitForSelector('#un');
  await p.type('#un', `نورة ${stamp}`);
  await p.type('#ue', newEmail);
  await p.select('#ud', D.COMM);
  await p.evaluate(() => [...document.querySelectorAll('input[name=method]')][1].click());
  await clickText(p, 'إنشاء الحساب');
  await p.waitForSelector('p.select-all');
  tempPw = await p.$eval('p.select-all', (e) => e.innerText.trim());
  if (tempPw.length < 16) throw new Error('كلمة المرور المؤقتة قصيرة');
  await shot(p, 'user_created', false);
  const { data: prof } = await db.from('profiles').select('must_change_password,department_id,role').eq('email', newEmail).single();
  if (!prof.must_change_password || prof.department_id !== D.COMM || prof.role !== 'employee') throw new Error('بيانات الحساب غير صحيحة');
  return 'كلمة مؤقتة من ' + tempPw.length + ' حرفًا';
});
let noura;
await step('18. أول دخول يفرض تغيير كلمة المرور، ثم تغييرها من «حسابي»', async () => {
  noura = await session(newEmail, { password: tempPw, width: 390, height: 844 });
  if (!noura.page.url().includes('/auth/set-password')) throw new Error('لم يُطلب تعيين كلمة مرور: ' + noura.page.url());
  await noura.page.goto(BASE + '/my-tasks', { waitUntil: 'networkidle0' });
  if (!noura.page.url().includes('/auth/set-password')) throw new Error('وصل للمنصة قبل تغيير كلمة المرور');
  await noura.page.type('#np1', 'password123');
  const weak = await noura.page.evaluate(() => document.body.innerText.includes('شائعة'));
  if (!weak) throw new Error('لم تُرفض كلمة مرور ضعيفة');
  await noura.page.$eval('#np1', (e) => (e.value = ''));
  await noura.page.goto(BASE + '/auth/set-password', { waitUntil: 'networkidle0' });
  await noura.page.type('#np1', 'Noura-Strong-2026');
  await noura.page.type('#np2', 'Noura-Strong-2026');
  await Promise.all([noura.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), noura.page.click('button[type=submit]')]);
  await sleep(1000);
  if (!noura.page.url().includes('/my-tasks')) throw new Error('لم يصل لمهامي: ' + noura.page.url());
  await noura.page.goto(BASE + '/account', { waitUntil: 'networkidle0' });
  await noura.page.type('#p0', 'Noura-Strong-2026');
  await noura.page.type('#p1', 'Noura-Second-2027');
  await noura.page.type('#p2', 'Noura-Second-2027');
  await clickText(noura.page, 'تغيير كلمة المرور');
  await waitText(noura.page, 'تغيرت كلمة المرور');
  const again = await session(newEmail, { password: 'Noura-Second-2027' });
  if (!again.page.url().includes('/my-tasks')) throw new Error('الدخول بالكلمة الجديدة فشل');
  await again.ctx.close();
});

// ---------- 9-12: الإسناد ----------
async function assign(stepId, { names = [], all = false, individual = false, lead = null }) {
  const p = mgr.page;
  await p.goto(`${BASE}/tasks/${stepId}`, { waitUntil: 'networkidle0' });
  await clickText(p, 'تعديل المكلفين');
  await p.waitForSelector('input[aria-label="بحث عن مستخدم"]');
  if (all) await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.innerText.includes('جميع موظفي الإدارة'))?.querySelector('input')?.click());
  for (const n of names) {
    await p.$eval('input[aria-label="بحث عن مستخدم"]', (e) => (e.value = ''));
    await p.type('input[aria-label="بحث عن مستخدم"]', n);
    await sleep(200);
    await p.evaluate((n) => [...document.querySelectorAll('label')].find((l) => l.innerText.includes(n) && l.querySelector('input[type=checkbox]'))?.querySelector('input')?.click(), n);
  }
  if (lead) await p.evaluate((n) => [...document.querySelectorAll('li')].find((l) => l.innerText.includes(n))?.querySelector('button[title="المسؤول الرئيسي"]')?.click(), lead);
  if (individual) await p.evaluate(() => [...document.querySelectorAll('input[name=mode]')][1].click());
  await clickText(p, 'حفظ الإسناد');
  await sleep(1800);
  const { data } = await db.from('step_assignees').select('user_id,is_lead').eq('step_id', stepId);
  return data;
}
const inMyTasks = async (page, title, view = 'month') => {
  await page.goto(`${BASE}/my-tasks?view=${view}`, { waitUntil: 'networkidle0' });
  return (await bodyText(page)).includes(title);
};
const rash = await session('rashid@demo.rawasim.local', { width: 390, height: 844 });
const allViews = async (page, title) => {
  for (const v of ['week', 'month', 'late', 'upcoming', 'done']) if (await inMyTasks(page, title, v)) return v;
  return null;
};

await step('9. إسناد مهمة لمستخدم واحد (بحث بالاسم)', async () => {
  const a = await assign(T1.id, { names: [rashid.full_name] });
  if (a.length !== 1 || a[0].user_id !== rashid.id) throw new Error(JSON.stringify(a));
  await shot(mgr.page, 'assign_single', false);
  const v = await allViews(rash.page, T1.title);
  if (!v) throw new Error('لا تظهر في مهامي');
  return 'تظهر في عرض ' + v;
});
await step('10. إسناد مهمة لعدة مستخدمين مع مسؤول رئيسي', async () => {
  const a = await assign(T2.id, { names: [rashid.full_name, `نورة ${stamp}`], lead: `نورة ${stamp}` });
  if (a.length !== 2) throw new Error('عدد المكلفين ' + a.length);
  if (a.filter((x) => x.is_lead).length !== 1) throw new Error('المسؤول الرئيسي غير محدد');
});
await step('11. إسناد مهمة لجميع موظفي الإدارة (فردية: كل مكلف يسجل إنجازه)', async () => {
  const a = await assign(T3.id, { all: true, individual: true });
  if (a.length < 3) throw new Error('عدد المكلفين ' + a.length);
  await shot(mgr.page, 'assign_all', false);
  return a.length + ' مكلفين';
});
await step('12. المهمة تظهر في «مهامي» لكل مكلف', async () => {
  for (const [who, page] of [
    ['رشيد', rash.page],
    ['نورة', noura.page],
  ]) {
    for (const t of [T2, T3]) if (!(await allViews(page, t.title))) throw new Error(`«${t.title}» لا تظهر لـ${who}`);
  }
  await rash.page.goto(BASE + '/my-tasks?view=month', { waitUntil: 'networkidle0' });
  await shot(rash.page, 'mytasks_mobile');
});

// ---------- 13: لا مضاعفة ----------
const deptTasksDone = async () => {
  await ed.page.goto(`${BASE}/dashboard/department/${D.COMM}?year=2026&q=4`, { waitUntil: 'networkidle0' });
  return ed.page.evaluate(() => {
    const block = [...document.querySelectorAll('div')].find((d) => d.firstElementChild?.innerText?.includes('المهام التنفيذية') && d.querySelector('ul'));
    const li = block && [...block.querySelectorAll('li')].find((l) => l.innerText.includes('مكتملة'));
    return li ? Number(li.querySelector('.num')?.textContent) : NaN;
  });
};
await step('13. المهمة المشتركة تُنجز مرة واحدة ولا يتضاعف الإنجاز بتعدد المكلفين', async () => {
  const before = await deptTasksDone();
  const { data: b0 } = await db.from('steps').select('progress').eq('id', T2.id).single();
  // رشيد يكمل المهمة المشتركة مع المخرج المتحقق
  await rash.page.goto(`${BASE}/tasks/${T2.id}`, { waitUntil: 'networkidle0' });
  await clickText(rash.page, 'مكتملة', '[aria-label="الحالة"] button');
  await rash.page.type('#out-c', 'أُنجز المخرج كاملًا [اختبار]');
  await clickText(rash.page, 'حفظ التحديث');
  await sleep(2000);
  // نورة تفتح المهمة نفسها: مكتملة لها أيضًا، دون سجل ثانٍ
  await noura.page.goto(`${BASE}/tasks/${T2.id}`, { waitUntil: 'networkidle0' });
  const txt = await bodyText(noura.page);
  if (!txt.includes('مكتملة')) throw new Error('لا تظهر مكتملة للشريك');
  const after = await deptTasksDone();
  if (after !== before + 1) throw new Error(`عدد المهام المكتملة ${before} ← ${after}`);
  const { data: s } = await db.from('steps').select('progress,status').eq('id', T2.id).single();
  if (Number(s.progress) !== 100 || Number(b0.progress) !== 0) throw new Error('إنجاز غير متوقع');
  // المهمة الفردية: إنجاز رشيد وحده لا يغلقها
  await rash.page.goto(`${BASE}/tasks/${T3.id}`, { waitUntil: 'networkidle0' });
  await rash.page.type('textarea[aria-label="ما أنجزته"]', 'أنجزت جزئي [اختبار]');
  await clickText(rash.page, 'سجلت إنجازي');
  await sleep(1800);
  const { data: s3 } = await db.from('steps').select('status,progress').eq('id', T3.id).single();
  if (s3.status === 'completed') throw new Error('أغلقها شخص واحد');
  await shot(rash.page, 'individual_task');
  return `مكتملة ${before}←${after}، الفردية ${s3.status} ${s3.progress}٪`;
});

// ---------- 14/15: التواريخ ----------
const iso = (d) => d.toISOString().slice(0, 10);
await step('14/15. تحديد بداية ونهاية المهمة وظهورها في الأسبوع والشهر الصحيحين', async () => {
  await assign(T4.id, { names: [rashid.full_name] });
  const now = new Date();
  const sun = new Date(now);
  sun.setDate(now.getDate() - now.getDay());
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const p = mgr.page;
  await p.goto(`${BASE}/tasks/${T4.id}`, { waitUntil: 'networkidle0' });
  const setDates = async (a, b) => {
    await p.waitForSelector('input[aria-label="تاريخ البداية"]');
    await p.$eval('input[aria-label="تاريخ البداية"]', (e, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, a);
    await p.$eval('input[aria-label="تاريخ النهاية"]', (e, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, b);
    await clickText(p, 'اعتماد التواريخ');
    await sleep(1500);
  };
  await setDates(iso(sun), iso(sat));
  const { data: s } = await db.from('steps').select('start_date,end_date,dates_source').eq('id', T4.id).single();
  if (s.dates_source !== 'manual' || s.start_date !== iso(sun)) throw new Error(JSON.stringify(s));
  if (!(await inMyTasks(rash.page, T4.title, 'week'))) throw new Error('لا تظهر في هذا الأسبوع');
  // نقلها إلى منتصف الشهر القادم
  const nm = new Date(now.getFullYear(), now.getMonth() + 1, 10);
  const nm2 = new Date(now.getFullYear(), now.getMonth() + 1, 16);
  await p.goto(`${BASE}/tasks/${T4.id}`, { waitUntil: 'networkidle0' });
  await setDates(iso(nm), iso(nm2));
  if (await inMyTasks(rash.page, T4.title, 'week')) throw new Error('ما زالت في هذا الأسبوع');
  if (await inMyTasks(rash.page, T4.title, 'month')) throw new Error('تظهر في الشهر الحالي');
  if (!(await inMyTasks(rash.page, T4.title, 'upcoming'))) throw new Error('لا تظهر في القادمة');
  await shot(p, 'task_dates', false);
  return `${iso(sun)} ← ${iso(nm)}`;
});

// ---------- 16: المخرجات والشواهد ----------
await step('16. المخرج المطلوب بارز، والمتحقق والشاهد مسجلان، والإرفاق وحده لا يكمل', async () => {
  await assign(T5.id, { names: [rashid.full_name] });
  const p = rash.page;
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(`${BASE}/tasks/${T5.id}`, { waitUntil: 'networkidle0' });
  const txt = await bodyText(p);
  if (!txt.includes('المخرج المطلوب')) throw new Error('المخرج المطلوب غير ظاهر');
  await p.type('textarea[aria-label="المخرج المتحقق"]', 'مسودة أولى منشورة [اختبار]');
  await clickText(p, 'حفظ المخرج');
  await sleep(1200);
  await clickText(p, 'إضافة رابط');
  await p.waitForSelector('input[aria-label="الرابط"]');
  await p.type('input[aria-label="الرابط"]', 'https://example.org/evidence.pdf');
  await p.type('input[aria-label="عنوان الرابط"]', 'الشاهد');
  await clickText(p, 'حفظ الرابط');
  await sleep(1500);
  const { data: s } = await db.from('steps').select('status,output_achieved').eq('id', T5.id).single();
  const { data: ev } = await db.from('evidence').select('kind,url').eq('step_id', T5.id);
  if (s.status === 'completed') throw new Error('اكتملت بمجرد الإرفاق');
  if (!s.output_achieved || !ev.some((e) => e.kind === 'link')) throw new Error('لم يُحفظ المخرج أو الشاهد');
  await shot(p, 'task_outputs');
  await p.setViewport({ width: 390, height: 844 });
});

// ---------- 7/8: الأوزان ----------
await step('7/8. تعديل أوزان الأنشطة من «إدارة الأوزان» وإعادة احتساب الإنجاز', async () => {
  const { data: plan } = await db.from('op_plans').select('id').eq('department_id', D.EXEC).eq('year', 2026).eq('quarter', 4).single();
  const { data: acts } = await db.from('activities').select('id,title,weight').eq('plan_id', plan.id).order('weight');
  const p = ed.page;
  await p.goto(`${BASE}/plans/${plan.id}`, { waitUntil: 'networkidle0' });
  await clickText(p, 'إدارة الأوزان', 'a');
  await p.waitForFunction(() => location.pathname.endsWith('/weights'));
  await p.waitForSelector('input[aria-label^="وزن "]');
  const lo = acts[0];
  const hi = acts.at(-1);
  const setW = async (title, v) => {
    await p.$eval(`input[aria-label="وزن ${title}"]`, (el) => el.focus());
    await p.keyboard.down('Control');
    await p.keyboard.press('A');
    await p.keyboard.up('Control');
    await p.keyboard.type(String(v));
  };
  // تجاوز المجموع يُمنع
  await setW(lo.title, Number(lo.weight) + 5);
  if (!(await bodyText(p)).includes('لا يمكن الحفظ قبل إكمال التوزيع')) throw new Error('لم يُمنع التوزيع الناقص');
  await shot(p, 'weights_error');
  await setW(hi.title, Number(hi.weight) - 5);
  await p.type('#rs', 'إعادة موازنة [اختبار]');
  await clickText(p, 'تطبيق التعديل');
  await p.waitForFunction(() => !location.pathname.endsWith('/weights'), { timeout: 20000 });
  const { data: after } = await db.from('activities').select('id,weight').in('id', [lo.id, hi.id]);
  const w = Object.fromEntries(after.map((a) => [a.id, Number(a.weight)]));
  if (w[lo.id] !== Number(lo.weight) + 5 || w[hi.id] !== Number(hi.weight) - 5) throw new Error('لم تُطبق الأوزان');
  // الإنجاز يُحتسب بالأوزان الجديدة: نقارن ما تعرضه صفحة الإدارة بالحساب المباشر
  const { data: fa } = await db.from('activities').select('id,weight,steps(weight,progress,is_archived)').eq('plan_id', plan.id).eq('is_archived', false);
  const expected = Math.round(fa.reduce((s, a) => s + (a.weight * a.steps.filter((x) => !x.is_archived).reduce((t, x) => t + (x.weight * x.progress) / 100, 0)) / 100, 0) * 100) / 100;
  await p.goto(`${BASE}/dashboard/department/${D.EXEC}?year=2026&q=4`, { waitUntil: 'networkidle0' });
  const shown = await p.evaluate(() => Number(document.querySelector('p.num.text-5xl')?.textContent.replace(/[^\d.]/g, '')));
  if (Math.abs(shown - expected) > 0.1) throw new Error(`المعروض ${shown} والمتوقع ${expected}`);
  return `إنجاز الإدارة ${shown}٪`;
});

// ---------- 19: الفصل في المؤشرات ----------
await step('19. فصل المشاريع والأنشطة عن المهام في اللوحة والإدارة والقائمة', async () => {
  await ed.page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
  const t = await bodyText(ed.page);
  for (const s of ['المشاريع والأنشطة', 'المهام التنفيذية', 'مشروع ·']) if (!t.includes(s)) throw new Error('غير ظاهر: ' + s);
  await ed.page.goto(`${BASE}/activities?kind=project`, { waitUntil: 'networkidle0' });
  const t2 = await bodyText(ed.page);
  if (!/\d+ مشروع · 0 نشاط/.test(t2)) throw new Error('مرشح المشاريع لا يعمل');
});

// ---------- 1-6: روابط العرض ----------
let token = '';
await step('1. إنشاء رابط عرض من المدير التنفيذي', async () => {
  const p = ed.page;
  await p.goto(BASE + '/share-links', { waitUntil: 'networkidle0' });
  await clickText(p, 'رابط عرض جديد');
  await p.waitForSelector('#sl-name');
  await p.type('#sl-name', 'شاشة الاستقبال [اختبار]');
  await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.innerText.includes('السماح بالتعمق'))?.querySelector('input')?.click());
  await p.select('#sl-refresh', '30');
  await clickText(p, 'إنشاء الرابط', 'button[type=submit]');
  await p.waitForSelector('code');
  token = await p.$eval('code', (c) => c.innerText.split('/share/')[1]);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('رمز غير متوقع');
  // مدير الإدارة لا يصل للصفحة
  await mgr.page.goto(BASE + '/share-links', { waitUntil: 'networkidle0' });
  if (mgr.page.url().includes('/share-links')) throw new Error('مدير الإدارة وصل لروابط العرض');
  await shot(p, 'share_links', false);
});
let viewer;
await step('2/3. فتح الرابط دون حساب على شاشة كبيرة 16:9 دون تمرير', async () => {
  viewer = await anonPage(1920, 1080);
  await viewer.goto(`${BASE}/share/${token}`, { waitUntil: 'networkidle0' });
  const t = await bodyText(viewer);
  if (!t.includes('إنجاز الإدارات') || !t.includes('المهام التنفيذية')) throw new Error('اللوحة لم تظهر');
  const [sh, ih] = await viewer.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  if (sh > ih + 1) throw new Error(`تمرير عمودي ${sh}>${ih}`);
  await shot(viewer, 'share_tv', false);
  await viewer.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('الأداء التنفيذي'))?.click());
  await sleep(600);
  await shot(viewer, 'share_tv_exec', false);
  await viewer.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('الأداء التشغيلي'))?.click());
  // وضع التلفاز والجوال
  const tv = await anonPage(1366, 768);
  await tv.goto(`${BASE}/share/${token}?tv=1`, { waitUntil: 'networkidle0' });
  const [a, b] = await tv.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  if (a > b + 1) throw new Error('تمرير على 1366×768');
  const mob = await anonPage(390, 844);
  await mob.goto(`${BASE}/share/${token}`, { waitUntil: 'networkidle0' });
  if (await mob.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('تمرير أفقي على الجوال');
  await shot(mob, 'share_mobile');
});
await step('6. لا تسريب: لا أسماء موظفين ولا توجيهات ولا ملاحظات ولا روابط داخلية', async () => {
  const t = await bodyText(viewer);
  const { data: names } = await db.from('profiles').select('full_name');
  const leaked = names.map((n) => n.full_name).filter((n) => t.includes(n));
  if (leaked.length) throw new Error('أسماء ظاهرة: ' + leaked.join('، '));
  for (const s of ['[تجريبي] مراجعة جدول المشتريات', 'اعتماد موازنة رحلة', 'أُنجز المخرج كاملًا', 'example.org', 'الإعدادات', 'تسجيل الخروج']) if (t.includes(s)) throw new Error('ظاهر: ' + s);
  const api = await viewer.evaluate(async (tk) => (await fetch(`/api/share/${tk}`)).text(), token);
  for (const s of ['@demo', 'output', 'note', 'assignee', 'responsible']) if (api.includes(s)) throw new Error('في واجهة البيانات: ' + s);
  // صفحات المنصة الداخلية مغلقة أمام الزائر
  await viewer.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
  if (!viewer.url().includes('/login')) throw new Error('الزائر وصل للوحة الداخلية');
  await viewer.goto(`${BASE}/share/${token}`, { waitUntil: 'networkidle0' });
});
await step('4. تحديث البيانات في اللوحة المفتوحة', async () => {
  const before = await viewer.evaluate(() => document.body.innerText.match(/(\d+)\s*\n?\s*داخل المشاريع والأنشطة/)?.[0] ?? '');
  const readDone = () =>
    viewer.evaluate(() => {
      const card = [...document.querySelectorAll('section')].find((s) => s.innerText.startsWith('المهام التنفيذية'));
      const li = card && [...card.querySelectorAll('li')].find((l) => l.innerText.includes('مكتملة'));
      return li ? Number(li.querySelector('.num')?.textContent) : NaN;
    });
  const d0 = await readDone();
  // إنجاز مهمة جديدة من الداخل
  const { data: s } = await db.from('steps').select('id').eq('id', T4.id).single();
  await rash.page.goto(`${BASE}/tasks/${s.id}`, { waitUntil: 'networkidle0' });
  await clickText(rash.page, 'مكتملة', '[aria-label="الحالة"] button');
  await rash.page.type('#out-c', 'تم [اختبار التحديث]');
  await clickText(rash.page, 'حفظ التحديث');
  await sleep(1500);
  await viewer.evaluate(() => document.querySelector('button[aria-label="تحديث الآن"]')?.click());
  await sleep(2500);
  const d1 = await readDone();
  if (!(d1 === d0 + 1)) throw new Error(`المكتملة ${d0} ← ${d1}`);
  const footer = await bodyText(viewer);
  if (!footer.includes('آخر تحديث ناجح')) throw new Error('لا يظهر وقت آخر تحديث');
  void before;
  return `${d0} ← ${d1}`;
});
await step('5. إلغاء الرابط يوقف الشاشات المفتوحة فورًا عند التحديث', async () => {
  const p = ed.page;
  await p.goto(BASE + '/share-links', { waitUntil: 'networkidle0' });
  p.once('dialog', (d) => d.accept());
  await p.click('button[aria-label="إلغاء نهائي"]');
  for (let i = 0; i < 20; i++) {
    const { data } = await db.from('share_links').select('revoked_at').eq('token', token).single();
    if (data.revoked_at) break;
    await sleep(500);
  }
  await viewer.evaluate(() => document.querySelector('button[aria-label="تحديث الآن"]')?.click());
  await waitText(viewer, 'لم يعد هذا الرابط متاحًا');
  const fresh = await anonPage(1280, 800);
  await fresh.goto(`${BASE}/share/${token}`, { waitUntil: 'networkidle0' });
  if (!(await bodyText(fresh)).includes('هذا الرابط غير متاح')) throw new Error('الرابط ما زال يعمل');
  await shot(viewer, 'share_revoked', false);
});

// ---------- 21: الهوية على الجوال وسطح المكتب ----------
await step('21. الهوية البصرية على الجوال وسطح المكتب دون تمرير أفقي', async () => {
  const pages = ['/dashboard', '/my-tasks', '/activities', '/share-links', `/tasks/${T2.id}`, `/plans/${commPlan.id}`];
  const bad = [];
  const m = await session('ed@demo.rawasim.local', { width: 390, height: 844 });
  for (const u of pages) {
    await m.page.goto(BASE + u, { waitUntil: 'networkidle0' });
    if (await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(u);
  }
  await shot(m.page, 'plan_mobile');
  const login = await anonPage(390, 844);
  await login.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await shot(login, 'login_mobile', false);
  const loginD = await anonPage(1440, 900);
  await loginD.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await shot(loginD, 'login_desktop', false);
  if (bad.length) throw new Error('تمرير أفقي في: ' + bad.join('، '));
});

await browser.close();
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ناجحة`);
process.exit(failed ? 1 : 0);
