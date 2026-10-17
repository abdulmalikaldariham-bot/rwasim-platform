/**
 * اختبارات تكامل للتطويرات: روابط العرض الخارجية، الإسناد المتعدد، صفحة مهامي،
 * التواريخ، المخرجات، الأوزان، فصل المشاريع عن المهام، والحسابات.
 * تُشغَّل على قاعدة بيانات اختبار فقط (تنشئ مستخدمين وبيانات لسنة 2028 ثم تحذف المستخدمين).
 *
 *   TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_KEY=... npm run test:integration
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateQuarter, loadYearProgress } from '../../src/lib/data/progress';
import { buildModel } from '../../src/lib/display/build';
import { overlaps } from '../../src/lib/data/tasks';

const URL = process.env.TEST_SUPABASE_URL;
const ANON = process.env.TEST_SUPABASE_ANON_KEY!;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_KEY!;
const run = URL ? describe : describe.skip;
const PASSWORD = 'Test-Password-2028!';
const YEAR = 2028;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let admin: SupabaseClient;
let anon: SupabaseClient;
const users: Record<string, { id: string; sb: SupabaseClient; email: string }> = {};
const dept: Record<string, string> = {};
const created: string[] = [];

const ok = <T = any>(r: { data: T; error: { message: string } | null } | any): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

async function makeUser(key: string, role: string, code?: string, name?: string) {
  const email = `${key}.${Date.now()}@test.rawasim.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name ?? key },
    app_metadata: { role, department_id: code ? dept[code] : null },
  });
  if (error) throw error;
  created.push(data.user!.id);
  const sb = createClient(URL!, ANON, opts);
  ok(await sb.auth.signInWithPassword({ email, password: PASSWORD }));
  users[key] = { id: data.user!.id, sb, email };
}

// خطة صغيرة معروفة الأوزان: مشروع (3 مهام) ونشاط (مهمتان)
let planId: string;
let otherPlanId: string;
const act: Record<string, string> = {};
const st: Record<string, string> = {};

run('التطويرات: الإسناد، المهام، المخرجات، الأوزان، روابط العرض', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE, opts);
    anon = createClient(URL!, ANON, opts);
    for (const d of ok(await admin.from('departments').select('id,code')) as { id: string; code: string }[]) dept[d.code] = d.id;
    await makeUser('ed', 'executive_director', undefined, 'المدير التنفيذي');
    await makeUser('mgr', 'dept_manager', 'SUPP', 'مدير المساندة');
    await makeUser('mgrOther', 'dept_manager', 'COMM', 'مدير الاتصال');
    await makeUser('e1', 'employee', 'SUPP', 'سعد');
    await makeUser('e2', 'employee', 'SUPP', 'هدى');
    await makeUser('e3', 'employee', 'SUPP', 'فهد');
    await makeUser('outsider', 'employee', 'COMM', 'من إدارة أخرى');
    await makeUser('board', 'board_member', undefined, 'عضو المجلس');

    // سنة 2028 بحدود أسابيع افتراضية
    ok(await users.ed.sb.rpc('create_year', { p_year: YEAR }));
    const sb = users.mgr.sb;
    planId = (ok(await sb.from('op_plans').insert({ year: YEAR, quarter: 1, department_id: dept.SUPP, created_by: users.mgr.id }).select('id').single()) as { id: string }).id;
    act.p = (ok(await sb.from('activities').insert({ plan_id: planId, seq: 1, title: 'مشروع مشوار الأشبال', kind: 'project', weight: 60 }).select('id').single()) as { id: string }).id;
    act.a = (ok(await sb.from('activities').insert({ plan_id: planId, seq: 2, title: 'نشاط النشرة الشهرية', kind: 'recurring', weight: 40 }).select('id').single()) as { id: string }).id;
    const ins = async (key: string, a: string, seq: number, title: string, weight: number, weeks: number[], output: string, core = false) => {
      st[key] = (ok(await sb.from('steps').insert({ activity_id: act[a], plan_id: planId, seq, title, weight, is_core: core, output }).select('id').single()) as { id: string }).id;
      if (weeks.length) ok(await sb.from('step_weeks').insert(weeks.map((w) => ({ step_id: st[key], week_index: w }))));
    };
    await ins('doc', 'p', 1, 'إعداد الوثيقة', 30, [1, 2], 'وثيقة المشروع');
    await ins('exec', 'p', 2, 'التنفيذ', 40, [5, 6, 7], 'تقرير التنفيذ', true);
    await ins('close', 'p', 3, 'الإغلاق', 30, [11], 'التقرير الختامي');
    await ins('send', 'a', 1, 'إرسال النشرة', 50, [3], 'نشرة مرسلة');
    await ins('form', 'a', 2, 'تعبئة نموذج الرضا', 50, [], 'نماذج مكتملة');
    ok(await users.ed.sb.rpc('approve_plan', { p_plan: planId }));

    otherPlanId = (ok(await users.mgrOther.sb.from('op_plans').insert({ year: YEAR, quarter: 1, department_id: dept.COMM, created_by: users.mgrOther.id }).select('id').single()) as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  // ---------------- التواريخ ----------------
  it('14. تاريخ البداية والنهاية يُستخرجان من الجدولة الأسبوعية، والمهمة بلا جدولة تبقى للمراجعة', async () => {
    const rows = ok(await users.mgr.sb.from('steps').select('id,planned_start,planned_end,dates_source').in('id', Object.values(st))) as { id: string; planned_start: string | null; planned_end: string | null; dates_source: string }[];
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[st.doc].planned_start).toBe(`${YEAR}-01-01`);
    expect(by[st.doc].planned_end).toBe(`${YEAR}-01-14`);
    expect(by[st.exec].planned_start).toBe(`${YEAR}-02-01`);
    expect(by[st.form].planned_end).toBeNull(); // لا يُخترع تاريخ
    expect(by[st.doc].dates_source).toBe('weeks');
  });

  it('14. تعديل التواريخ للمخول فقط، مع مزامنة الأسابيع وتسجيل التعديل', async () => {
    const denied = await users.e1.sb.rpc('set_step_dates', { p_step: st.form, p_start: `${YEAR}-03-01`, p_end: `${YEAR}-03-20` });
    expect(denied.error).toBeTruthy();
    const other = await users.mgrOther.sb.rpc('set_step_dates', { p_step: st.form, p_start: `${YEAR}-03-01`, p_end: `${YEAR}-03-20` });
    expect(other.error).toBeTruthy();
    ok(await users.mgr.sb.rpc('set_step_dates', { p_step: st.form, p_start: `${YEAR}-03-01`, p_end: `${YEAR}-03-20`, p_reason: 'تحديد موعد الاستبيان' }));
    const s = ok(await users.mgr.sb.from('steps').select('planned_start,planned_end,dates_source,step_weeks(week_index)').eq('id', st.form).single()) as { planned_start: string; planned_end: string; dates_source: string; step_weeks: { week_index: number }[] };
    expect([s.planned_start, s.planned_end, s.dates_source]).toEqual([`${YEAR}-03-01`, `${YEAR}-03-20`, 'manual']);
    expect(s.step_weeks.map((w) => w.week_index).sort((a, b) => a - b)).toEqual([9, 10, 11]);
    const log = ok(await users.mgr.sb.from('step_updates').select('note').eq('step_id', st.form)) as { note: string }[];
    expect(log.some((l) => l.note.includes('تحديد موعد الاستبيان'))).toBe(true);
    // تعديل مباشر على الأعمدة ممنوع
    const direct = await users.mgr.sb.from('steps').update({ planned_end: `${YEAR}-03-30` }).eq('id', st.form);
    expect(direct.error?.message).toMatch(/set_step_dates/);
  });

  it('15. ظهور المهمة في الأسبوع والشهر الصحيحين (تقاطع الفترات)', () => {
    expect(overlaps(`${YEAR}-02-01`, `${YEAR}-02-21`, `${YEAR}-02-08`, `${YEAR}-02-14`)).toBe(true);
    expect(overlaps(`${YEAR}-02-01`, `${YEAR}-02-21`, `${YEAR}-03-01`, `${YEAR}-03-31`)).toBe(false);
    expect(overlaps(`${YEAR}-01-28`, `${YEAR}-02-03`, `${YEAR}-02-01`, `${YEAR}-02-29`)).toBe(true);
    expect(overlaps(null, null, `${YEAR}-02-01`, `${YEAR}-02-29`)).toBe(false);
  });

  // ---------------- الإسناد ----------------
  it('9. إسناد مهمة إلى مستخدم واحد، ورفض الإسناد من خارج الإدارة', async () => {
    ok(await users.mgr.sb.rpc('set_step_assignees', { p_step: st.doc, p_users: [users.e1.id] }));
    const bad = await users.mgr.sb.rpc('set_step_assignees', { p_step: st.doc, p_users: [users.outsider.id] });
    expect(bad.error?.message).toMatch(/خارج الإدارة/);
    const denied = await users.e1.sb.rpc('set_step_assignees', { p_step: st.doc, p_users: [users.e1.id, users.e2.id] });
    expect(denied.error).toBeTruthy();
    const s = ok(await users.mgr.sb.from('steps').select('assignee_id').eq('id', st.doc).single()) as { assignee_id: string };
    expect(s.assignee_id).toBe(users.e1.id); // التوافق: المسؤول الرئيسي
  });

  it('10. إسناد مهمة إلى عدة مستخدمين مع مسؤول رئيسي — تظهر لدى كل مكلف', async () => {
    ok(await users.mgr.sb.rpc('set_step_assignees', { p_step: st.exec, p_users: [users.e1.id, users.e2.id], p_lead: users.e2.id, p_mode: 'collaborative' }));
    const rows = ok(await users.mgr.sb.from('task_assignees').select('user_id,is_lead').eq('step_id', st.exec)) as { user_id: string; is_lead: boolean }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.is_lead)?.user_id).toBe(users.e2.id);
    for (const k of ['e1', 'e2']) {
      const mine = ok(await users[k].sb.from('steps').select('id,task_assignees!inner(user_id)').eq('task_assignees.user_id', users[k].id)) as { id: string }[];
      expect(mine.map((m) => m.id)).toContain(st.exec);
    }
    // e3 لا يرى المهمة ولا خطتها
    expect((ok(await users.e3.sb.from('steps').select('id').eq('id', st.exec)) as unknown[]).length).toBe(0);
    expect((ok(await users.e3.sb.from('op_plans').select('id').eq('id', planId)) as unknown[]).length).toBe(0);
    // e1 يرى مهامه فقط من الخطة
    const visible = ok(await users.e1.sb.from('steps').select('id').eq('plan_id', planId)) as { id: string }[];
    expect(visible.map((v) => v.id).sort()).toEqual([st.doc, st.exec].sort());
  });

  it('11-12. إسناد مهمة لجميع موظفي الإدارة — تظهر في «مهامي» لكل منهم', async () => {
    ok(await users.mgr.sb.rpc('set_step_assignees', { p_step: st.form, p_users: [], p_all_dept: true, p_mode: 'individual', p_threshold: 100 }));
    const rows = ok(await users.mgr.sb.from('task_assignees').select('user_id').eq('step_id', st.form)) as { user_id: string }[];
    const ids = rows.map((r) => r.user_id);
    for (const k of ['e1', 'e2', 'e3', 'mgr']) expect(ids).toContain(users[k].id);
    expect(ids).not.toContain(users.outsider.id);
    for (const k of ['e1', 'e2', 'e3']) {
      const mine = ok(await users[k].sb.from('steps').select('id,task_assignees!inner(user_id)').eq('task_assignees.user_id', users[k].id)) as { id: string }[];
      expect(mine.map((m) => m.id)).toContain(st.form);
    }
    const s = ok(await users.mgr.sb.from('steps').select('assign_scope,assignment_mode').eq('id', st.form).single()) as { assign_scope: string; assignment_mode: string };
    expect(s).toEqual({ assign_scope: 'all_dept', assignment_mode: 'individual' });
    // تثبيت المكلفين لبقية الاختبارات (قد تضم الإدارة مستخدمين من اختبارات أخرى)
    ok(await users.mgr.sb.rpc('set_step_assignees', { p_step: st.form, p_users: [users.e1.id, users.e2.id, users.e3.id, users.mgr.id], p_mode: 'individual', p_threshold: 100 }));
  });

  // ---------------- المخرجات ----------------
  it('16. إكمال المهمة يتطلب المخرج المتحقق، والشاهد وحده لا يغلقها', async () => {
    // e1 مكلف بإعداد الوثيقة: رفع شاهد رابط لا يغير الحالة
    ok(await users.e1.sb.from('evidence').insert({ step_id: st.doc, plan_id: planId, kind: 'link', url: 'https://example.org/doc', file_name: 'وثيقة المشروع', uploaded_by: users.e1.id }));
    const s0 = ok(await users.e1.sb.from('steps').select('status,progress').eq('id', st.doc).single()) as { status: string; progress: number };
    expect([s0.status, Number(s0.progress)]).toEqual(['not_started', 0]);
    // بلا مخرج متحقق: مرفوض
    const bad = await users.e1.sb.rpc('update_step_progress', { p_step: st.doc, p_status: 'completed' });
    expect(bad.error?.message).toMatch(/المخرج المتحقق/);
    // رابط غير صالح مرفوض
    const badLink = await users.e1.sb.from('evidence').insert({ step_id: st.doc, plan_id: planId, kind: 'link', url: 'javascript:alert(1)', file_name: 'x', uploaded_by: users.e1.id });
    expect(badLink.error).toBeTruthy();
    ok(await users.e1.sb.rpc('update_step_progress', { p_step: st.doc, p_status: 'completed', p_note: 'تم', p_actual_output: 'وثيقة معتمدة من 12 صفحة' }));
    const s1 = ok(await users.mgr.sb.from('steps').select('status,progress,actual_output').eq('id', st.doc).single()) as { status: string; progress: number; actual_output: string };
    expect([s1.status, Number(s1.progress), s1.actual_output]).toEqual(['completed', 100, 'وثيقة معتمدة من 12 صفحة']);
    // لا يمكن تعديل المخرج المتحقق مباشرة
    expect((await users.mgr.sb.from('steps').update({ actual_output: 'x' }).eq('id', st.doc)).error?.message).toMatch(/update_step_progress/);
    // شرط «مخرج + شاهد»
    ok(await users.mgr.sb.from('steps').update({ output_requirement: 'evidence' }).eq('id', st.send));
    const noEv = await users.mgr.sb.rpc('update_step_progress', { p_step: st.send, p_status: 'completed', p_actual_output: 'أرسلت' });
    expect(noEv.error?.message).toMatch(/شاهد/);
    ok(await users.mgr.sb.from('evidence').insert({ step_id: st.send, plan_id: planId, kind: 'link', url: 'https://example.org/n', file_name: 'النشرة', uploaded_by: users.mgr.id }));
    ok(await users.mgr.sb.rpc('update_step_progress', { p_step: st.send, p_status: 'completed', p_actual_output: 'أرسلت لـ 300 مشترك' }));
    // شرط «لا يلزم توثيق»
    ok(await users.mgr.sb.from('steps').update({ output_requirement: 'none' }).eq('id', st.close));
  });

  // ---------------- عدم مضاعفة الإنجاز ----------------
  it('13. تعدد المكلفين لا يضاعف الإنجاز: المهمة سجل واحد بوزن واحد', async () => {
    ok(await users.e2.sb.rpc('update_step_progress', { p_step: st.exec, p_status: 'completed', p_actual_output: 'نُفذ المشروع' }));
    const ev = evaluateQuarter(await loadYearProgress(users.ed.sb, YEAR), 1, { asOf: `${YEAR}-03-31` });
    const d = ev.departments.find((x) => x.departmentId === dept.SUPP)!;
    const p = d.activities.find((a) => a.id === act.p)!;
    // المشروع: الوثيقة 30 + التنفيذ 40 = 70٪ مهما كان عدد المكلفين
    expect(p.progress).toBe(70);
    // الإدارة: 60×70٪ + 40×50٪ (النشرة) = 42 + 20 = 62
    expect(d.progress).toBe(62);
    // فصل المشاريع والأنشطة عن المهام
    expect(d.activitiesTotal).toBe(2);
    expect(d.projectsTotal).toBe(1);
    expect(d.stepsTotal).toBe(5);
    expect(d.stepsCompleted).toBe(3);
  });

  it('11. المهمة الفردية لا تكتمل بإنجاز موظف واحد، وتكتمل وفق القاعدة المحددة', async () => {
    ok(await users.e1.sb.rpc('update_step_progress', { p_step: st.form, p_status: 'completed', p_actual_output: 'عبأت النموذج' }));
    let s = ok(await users.mgr.sb.from('steps').select('status,progress').eq('id', st.form).single()) as { status: string; progress: number };
    expect(s.status).toBe('in_progress');
    expect(Number(s.progress)).toBe(25); // 1 من 4
    // مكلف لا يستطيع تحديث إنجاز غيره، والمدير يستطيع
    expect((await users.e1.sb.rpc('set_assignee_status', { p_step: st.form, p_user: users.e2.id, p_status: 'completed', p_output: 'x' })).error).toBeTruthy();
    ok(await users.mgr.sb.rpc('set_assignee_status', { p_step: st.form, p_user: users.e2.id, p_status: 'completed', p_output: 'سلّمت' }));
    // خفض النسبة إلى 50٪ يكمل المهمة
    ok(await users.mgr.sb.rpc('set_step_assignees', { p_step: st.form, p_users: [users.e1.id, users.e2.id, users.e3.id, users.mgr.id], p_mode: 'individual', p_threshold: 50 }));
    s = ok(await users.mgr.sb.from('steps').select('status,progress').eq('id', st.form).single()) as { status: string; progress: number };
    expect([s.status, Number(s.progress)]).toEqual(['completed', 100]);
    // ويبقى الإسناد فرديًا سجلًا واحدًا في النشاط
    const ev = evaluateQuarter(await loadYearProgress(users.ed.sb, YEAR), 1, { asOf: `${YEAR}-03-31` });
    expect(ev.departments.find((x) => x.departmentId === dept.SUPP)!.activities.find((a) => a.id === act.a)!.progress).toBe(100);
  });

  // ---------------- الأوزان ----------------
  it('7-8. تعديل أوزان نشاط عبر طلب معتمد، وإعادة الاحتساب، وسجل التعديلات', async () => {
    // تعديل مباشر على خطة معتمدة ممنوع
    expect((await users.mgr.sb.from('activities').update({ weight: 50 }).eq('id', act.p)).error?.message).toMatch(/معتمدة/);
    // طلب غير مكتمل يُرفض عند الاعتماد
    const badReq = ok(await users.mgr.sb.rpc('request_plan_change', { p_plan: planId, p_kind: 'weights', p_payload: { activities: [{ id: act.p, weight: 50 }] }, p_reason: 'خطأ' })) as string;
    expect((await users.ed.sb.rpc('decide_plan_change', { p_request: badReq, p_approve: true })).error?.message).toMatch(/الأوزان/);
    ok(await users.ed.sb.rpc('decide_plan_change', { p_request: badReq, p_approve: false, p_note: 'غير مكتمل' }));
    const req = ok(await users.mgr.sb.rpc('request_plan_change', { p_plan: planId, p_kind: 'weights', p_payload: { activities: [{ id: act.p, weight: 50 }, { id: act.a, weight: 50 }] }, p_reason: 'إعادة التوازن' })) as string;
    ok(await users.ed.sb.rpc('decide_plan_change', { p_request: req, p_approve: true }));
    const ev = evaluateQuarter(await loadYearProgress(users.ed.sb, YEAR), 1, { asOf: `${YEAR}-03-31` });
    // 50×70٪ + 50×100٪ = 85
    expect(ev.departments.find((x) => x.departmentId === dept.SUPP)!.progress).toBe(85);
    const hist = ok(await users.mgr.sb.rpc('get_weight_history', { p_plan: planId })) as { item_kind: string; old_weight: number; new_weight: number }[];
    expect(hist.some((h) => h.item_kind === 'activity' && Number(h.old_weight) === 60 && Number(h.new_weight) === 50)).toBe(true);
    // غير المخول لا يرى السجل
    expect((ok(await users.e1.sb.rpc('get_weight_history', { p_plan: planId })) as unknown[]).length).toBe(0);
    // حفظ توزيع مقترح لا يغير الأوزان المعتمدة
    ok(await users.mgr.sb.from('activities').update({ suggested_weight: 70 }).eq('id', act.p));
    const a = ok(await users.mgr.sb.from('activities').select('weight,suggested_weight').eq('id', act.p).single()) as { weight: number; suggested_weight: number };
    expect([Number(a.weight), Number(a.suggested_weight)]).toEqual([50, 70]);
  });

  // ---------------- روابط العرض ----------------
  let token: string;
  let linkId: string;
  it('1-2. إنشاء رابط عرض (للمدير التنفيذي فقط) وفتحه دون دخول', async () => {
    const denied = await users.mgr.sb.from('share_links').insert({ name: 'محاولة', year: YEAR });
    expect(denied.error).toBeTruthy();
    const l = ok(await users.ed.sb.from('share_links').insert({ name: 'شاشة المقر', year: YEAR, quarter: 1, sections: { ops: true, departments: true, curve: true, exec: true, activity_titles: false } }).select('id,token').single()) as { id: string; token: string };
    token = l.token;
    linkId = l.id;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    // الزائر لا يقرأ أي جدول
    expect(((await anon.from('share_links').select('*')).data ?? []).length).toBe(0);
    expect(((await anon.from('steps').select('id')).data ?? []).length).toBe(0);
    const raw = ok(await anon.rpc('get_display_data', { p_token: token })) as Record<string, unknown>;
    expect(raw.status).toBe('ok');
    const model = buildModel(raw);
    const supp = model.depts.find((d) => d.name.includes('المساندة'))!;
    expect(supp.progress).toBe(85);
    expect(supp.units).toBe(2);
    expect(supp.steps).toBe(5);
    // الإدارة ذات الخطة غير المعتمدة لا تظهر بياناتها
    expect(model.depts.find((d) => d.name.includes('الاتصال'))!.status).toBe('not_approved');
  });

  it('6. اللوحة لا تكشف بيانات غير مصرح بها', async () => {
    await users.ed.sb.from('directives').insert({ title: 'توجيه سري للاختبار', created_by: users.ed.id });
    const raw = ok(await anon.rpc('get_display_data', { p_token: token })) as Record<string, unknown>;
    const text = JSON.stringify(raw);
    for (const secret of ['توجيه سري', 'وثيقة معتمدة من 12 صفحة', 'example.org', 'إعداد الوثيقة', 'سعد', 'هدى', users.e1.email, users.e1.id, 'مشوار الأشبال'])
      expect(text.includes(secret)).toBe(false);
    // خطة الاتصال غير المعتمدة: لا محتوى
    expect(text.includes(otherPlanId)).toBe(false);
    // إظهار أسماء المشاريع عند السماح فقط
    ok(await users.ed.sb.from('share_links').update({ sections: { ops: true, departments: true, curve: true, exec: true, activity_titles: true } }).eq('id', linkId));
    const raw2 = JSON.stringify(ok(await anon.rpc('get_display_data', { p_token: token })));
    expect(raw2.includes('مشوار الأشبال')).toBe(true);
    expect(raw2.includes('إعداد الوثيقة')).toBe(false); // عناوين المهام لا تظهر أبدًا
  });

  it('4. تحديث بيانات اللوحة ينعكس فورًا', async () => {
    const before = buildModel(ok(await anon.rpc('get_display_data', { p_token: token })) as never).depts.find((d) => d.name.includes('المساندة'))!;
    ok(await users.mgr.sb.rpc('update_step_progress', { p_step: st.close, p_status: 'completed' }));
    const after = buildModel(ok(await anon.rpc('get_display_data', { p_token: token })) as never).depts.find((d) => d.name.includes('المساندة'))!;
    expect(after.stepsCompleted).toBe(before.stepsCompleted + 1);
    expect(after.progress).toBe(100);
  });

  it('رمز الوصول، والتنقل بين الفترات، وإيقاف المحاولات الخاطئة', async () => {
    ok(await users.ed.sb.rpc('set_share_link_code', { p_id: linkId, p_code: 'رواسم2028' }));
    const h = ok(await users.ed.sb.from('share_links').select('access_code_hash').eq('id', linkId).single()) as { access_code_hash: string };
    expect(h.access_code_hash.includes('رواسم2028')).toBe(false);
    expect((ok(await anon.rpc('get_display_data', { p_token: token })) as { status: string }).status).toBe('code_required');
    expect((ok(await anon.rpc('get_display_data', { p_token: token, p_code: 'خطأ' })) as { status: string }).status).toBe('code_invalid');
    expect((ok(await anon.rpc('get_display_data', { p_token: token, p_code: 'رواسم2028' })) as { status: string }).status).toBe('ok');
    // الربع ثابت ما لم يُسمح بالتنقل
    const fixed = ok(await anon.rpc('get_display_data', { p_token: token, p_code: 'رواسم2028', p_quarter: 3 })) as { period: { quarter: number } };
    expect(fixed.period.quarter).toBe(1);
    ok(await users.ed.sb.from('share_links').update({ allow_period_nav: true }).eq('id', linkId));
    const nav = ok(await anon.rpc('get_display_data', { p_token: token, p_code: 'رواسم2028', p_quarter: 3 })) as { period: { quarter: number } };
    expect(nav.period.quarter).toBe(3);
    for (let i = 0; i < 5; i++) await anon.rpc('get_display_data', { p_token: token, p_code: 'x' + i });
    expect((ok(await anon.rpc('get_display_data', { p_token: token, p_code: 'رواسم2028' })) as { status: string }).status).toBe('locked');
    // تعديل الرمز مباشرة ممنوع
    expect((await users.ed.sb.from('share_links').update({ access_code_hash: 'x' }).eq('id', linkId)).error).toBeTruthy();
    ok(await users.ed.sb.rpc('set_share_link_code', { p_id: linkId, p_code: null }));
  });

  it('5. تعطيل الرابط وانتهاء صلاحيته وإلغاؤه', async () => {
    ok(await users.ed.sb.from('share_links').update({ is_active: false }).eq('id', linkId));
    expect((ok(await anon.rpc('get_display_data', { p_token: token })) as { status: string }).status).toBe('invalid');
    ok(await users.ed.sb.from('share_links').update({ is_active: true, expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', linkId));
    expect((ok(await anon.rpc('get_display_data', { p_token: token })) as { status: string }).status).toBe('expired');
    ok(await users.ed.sb.from('share_links').delete().eq('id', linkId));
    expect((ok(await anon.rpc('get_display_data', { p_token: token })) as { status: string }).status).toBe('invalid');
    expect((ok(await anon.rpc('get_display_data', { p_token: 'a'.repeat(64) })) as { status: string }).status).toBe('invalid');
  });

  // ---------------- الحسابات ----------------
  it('17-18. حساب جديد برابط إعداد، تعيين كلمة المرور، وعدم تعديل علم التهيئة مباشرة', async () => {
    const email = `new.${Date.now()}@test.rawasim.local`;
    const { data } = await admin.auth.admin.createUser({ email, password: 'Unknown-' + Date.now() + 'aA1', email_confirm: true, user_metadata: { full_name: 'موظف جديد' }, app_metadata: { role: 'employee', department_id: dept.SUPP } });
    created.push(data.user!.id);
    ok(await admin.from('profiles').update({ must_change_password: true }).eq('id', data.user!.id));
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email });
    expect(link.error).toBeNull();
    const sb = createClient(URL!, ANON, opts);
    ok(await sb.auth.verifyOtp({ type: 'recovery', token_hash: link.data.properties!.hashed_token }));
    // لا يستطيع إسقاط العلم دون تغيير كلمة المرور
    expect((await sb.from('profiles').update({ must_change_password: false }).eq('id', data.user!.id)).error).toBeTruthy();
    ok(await sb.auth.updateUser({ password: 'NewSecret-2028x' }));
    ok(await sb.rpc('password_changed'));
    const p = ok(await sb.from('profiles').select('must_change_password,is_active').eq('id', data.user!.id).single()) as { must_change_password: boolean; is_active: boolean };
    expect(p).toEqual({ must_change_password: false, is_active: true });
    const again = createClient(URL!, ANON, opts);
    expect((await again.auth.signInWithPassword({ email, password: 'NewSecret-2028x' })).error).toBeNull();
    // الرابط لمرة واحدة
    expect((await createClient(URL!, ANON, opts).auth.verifyOtp({ type: 'recovery', token_hash: link.data.properties!.hashed_token })).error).toBeTruthy();
  });

  it('20. الصفحات القديمة: المجلس يقرأ الخطة المعتمدة دون المهام المسندة لغيره', async () => {
    expect((ok(await users.board.sb.from('steps').select('id').eq('plan_id', planId)) as unknown[]).length).toBe(5);
    expect((await users.board.sb.rpc('set_step_assignees', { p_step: st.doc, p_users: [] })).error).toBeTruthy();
  });
});
