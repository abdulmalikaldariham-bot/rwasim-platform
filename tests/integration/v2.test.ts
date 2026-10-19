/**
 * اختبارات تكامل للإصدار الثاني: الإسناد المتعدد، التواريخ، المخرجات، الأوزان بعد الاعتماد،
 * روابط عرض الأداء، وسياسات الحسابات. تعمل على سنة 2028 مستقلة عن اختبارات المنصة الأساسية.
 *
 *   TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_KEY=... npm run test:integration
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateQuarter, loadYearProgress } from '../../src/lib/data/progress';
import { orgCounts } from '../../src/lib/engine/counts';
import { buildShareView } from '../../src/lib/share/view';

const URL = process.env.TEST_SUPABASE_URL;
const ANON = process.env.TEST_SUPABASE_ANON_KEY!;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_KEY!;
const run = URL ? describe : describe.skip;
const PASSWORD = 'Test-Password-2026!';
const YEAR = 2028;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let admin: SupabaseClient;
let anon: SupabaseClient;
const u: Record<string, { id: string; sb: SupabaseClient }> = {};
const dept: Record<string, string> = {};
const created: string[] = [];
let planId = '';
const act: Record<string, string> = {};
const step: Record<string, string> = {};

const ok = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

async function mkUser(key: string, role: string, code?: string) {
  const email = `v2.${key}.${Date.now()}@test.rawasim.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `v2 ${key}` },
    app_metadata: { role, department_id: code ? dept[code] : null },
  });
  if (error) throw error;
  created.push(data.user!.id);
  const sb = createClient(URL!, ANON, opts);
  const si = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (si.error) throw si.error;
  u[key] = { id: data.user!.id, sb };
}

async function deptProgress() {
  const org = evaluateQuarter(await loadYearProgress(u.ed.sb, YEAR), 4, { asOf: `${YEAR}-10-20` });
  return { org, d: org.departments.find((x) => x.departmentId === dept.COMM)! };
}

run('الإصدار الثاني: المهام والإسناد والروابط والحسابات', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE, opts);
    anon = createClient(URL!, ANON, opts);
    for (const x of ok(await admin.from('departments').select('id,code')) as { id: string; code: string }[]) dept[x.code] = x.id;
    await mkUser('ed', 'executive_director');
    await mkUser('mgr', 'dept_manager', 'COMM');
    await mkUser('e1', 'employee', 'COMM');
    await mkUser('e2', 'employee', 'COMM');
    await mkUser('e3', 'employee', 'COMM');
    await mkUser('other', 'employee', 'EXEC');
    await mkUser('board', 'board_member');

    // سنة مستقلة وخطة يدوية: مشروع (60) فيه 3 مهام، ونشاط (40) فيه مهمتان
    const yr = await u.ed.sb.rpc('create_year', { p_year: YEAR });
    if (yr.error && !/موجود|exists|duplicate/.test(yr.error.message)) throw new Error(yr.error.message);
    const sb = u.mgr.sb;
    planId = (ok(await sb.from('op_plans').insert({ year: YEAR, quarter: 4, department_id: dept.COMM, created_by: u.mgr.id }).select('id').single()) as { id: string }).id;
    act.P = (ok(await sb.from('activities').insert({ plan_id: planId, seq: 1, title: 'مشروع الهوية الرقمية', kind: 'project', weight: 60 }).select('id').single()) as { id: string }).id;
    act.A = (ok(await sb.from('activities').insert({ plan_id: planId, seq: 2, title: 'النشرة الشهرية', kind: 'recurring', weight: 40 }).select('id').single()) as { id: string }).id;
    const rows = ok(
      await sb
        .from('steps')
        .insert([
          { activity_id: act.P, plan_id: planId, seq: 1, title: 'إعداد كراسة الهوية', weight: 30, is_core: false, output: 'كراسة الهوية' },
          { activity_id: act.P, plan_id: planId, seq: 2, title: 'تصميم الهوية', weight: 40, is_core: true, output: 'ملفات الهوية النهائية' },
          { activity_id: act.P, plan_id: planId, seq: 3, title: 'إطلاق الهوية', weight: 30, is_core: false, output: 'منشور الإطلاق' },
          { activity_id: act.A, plan_id: planId, seq: 1, title: 'كتابة محتوى النشرة', weight: 50, is_core: true, output: 'مسودة النشرة' },
          { activity_id: act.A, plan_id: planId, seq: 2, title: 'إرسال النشرة', weight: 50, is_core: false, output: 'تقرير الإرسال' },
        ])
        .select('id,seq,activity_id'),
    ) as { id: string; seq: number; activity_id: string }[];
    const key = (a: string, s: number) => rows.find((r) => r.activity_id === act[a] && r.seq === s)!.id;
    Object.assign(step, { P1: key('P', 1), P2: key('P', 2), P3: key('P', 3), A1: key('A', 1), A2: key('A', 2) });
    ok(
      await sb.from('step_weeks').insert([
        { step_id: step.P1, week_index: 1 },
        { step_id: step.P2, week_index: 2 },
        { step_id: step.P2, week_index: 3 },
        { step_id: step.P3, week_index: 4 },
        { step_id: step.A1, week_index: 3 },
        { step_id: step.A2, week_index: 4 },
      ]),
    );
    ok(await sb.rpc('submit_plan', { p_plan: planId }));
    ok(await u.ed.sb.rpc('approve_plan', { p_plan: planId }));
  });

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  // 14-15: التواريخ
  it('14/15. تواريخ المهمة تُشتق من الأسابيع، وتُعدل يدويًا بصلاحية، وتعود للأسابيع', async () => {
    const weeks = ok(await u.ed.sb.from('quarter_weeks').select('week_index,start_date,end_date').eq('year', YEAR).eq('quarter', 4).order('week_index')) as {
      week_index: number;
      start_date: string;
      end_date: string;
    }[];
    const s = ok(await u.mgr.sb.from('steps').select('start_date,end_date,dates_source').eq('id', step.P2).single()) as { start_date: string; end_date: string; dates_source: string };
    expect(s).toMatchObject({ start_date: weeks[1].start_date, end_date: weeks[2].end_date, dates_source: 'weeks' });

    // الموظف لا يعدل التواريخ
    expect((await u.e1.sb.rpc('set_step_dates', { p_step: step.P2, p_start: `${YEAR}-10-05`, p_end: `${YEAR}-10-20` })).error).toBeTruthy();
    // النهاية قبل البداية مرفوضة
    expect((await u.mgr.sb.rpc('set_step_dates', { p_step: step.P2, p_start: `${YEAR}-10-20`, p_end: `${YEAR}-10-05` })).error).toBeTruthy();
    ok(await u.mgr.sb.rpc('set_step_dates', { p_step: step.P2, p_start: `${YEAR}-10-05`, p_end: `${YEAR}-10-20` }));
    const m = ok(await u.mgr.sb.from('steps').select('start_date,end_date,dates_source').eq('id', step.P2).single());
    expect(m).toMatchObject({ start_date: `${YEAR}-10-05`, end_date: `${YEAR}-10-20`, dates_source: 'manual' });

    // تعديل الأسابيع لا يطغى على التاريخ اليدوي (يتطلب طلب تعديل بعد الاعتماد؛ نتحقق من دالة الاشتقاق مباشرة)
    ok(await u.mgr.sb.rpc('set_step_dates', { p_step: step.P2, p_start: null, p_end: null }));
    const back = ok(await u.mgr.sb.from('steps').select('start_date,end_date,dates_source').eq('id', step.P2).single());
    expect(back).toMatchObject({ start_date: weeks[1].start_date, end_date: weeks[2].end_date, dates_source: 'weeks' });
  });

  // 9-12: الإسناد
  it('9. إسناد لمستخدم واحد: يراها في «مهامي» وحده', async () => {
    expect(ok(await u.mgr.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [u.e1.id] }))).toBe(1);
    const e1 = ok(await u.e1.sb.from('steps').select('id')) as { id: string }[];
    expect(e1.map((x) => x.id)).toContain(step.P1);
    const e2 = ok(await u.e2.sb.from('steps').select('id').eq('id', step.P1)) as unknown[];
    expect(e2).toHaveLength(0);
    // التوافق مع الواجهة القديمة: assignee_id يعكس المكلف
    const s = ok(await u.mgr.sb.from('steps').select('assignee_id').eq('id', step.P1).single()) as { assignee_id: string };
    expect(s.assignee_id).toBe(u.e1.id);
  });

  it('9b. لا إسناد لموظف من إدارة أخرى ولا لموظف يُسند لنفسه', async () => {
    expect((await u.mgr.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [u.other.id] })).error?.message).toMatch(/الإدارة نفسها/);
    expect((await u.e1.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [u.e1.id, u.e2.id] })).error).toBeTruthy();
    // ولا كتابة مباشرة في جدول المكلفين
    expect((await u.mgr.sb.from('step_assignees').insert({ step_id: step.P1, user_id: u.e2.id })).error).toBeTruthy();
  });

  it('10. إسناد لعدة مستخدمين مع مسؤول رئيسي: كل منهم يراها، وغيرهم لا', async () => {
    expect(ok(await u.mgr.sb.rpc('set_step_assignees', { p_step: step.P2, p_users: [u.e1.id, u.e2.id], p_lead: u.e2.id }))).toBe(2);
    for (const k of ['e1', 'e2']) expect((ok(await u[k].sb.from('steps').select('id').eq('id', step.P2)) as unknown[]).length).toBe(1);
    expect((ok(await u.e3.sb.from('steps').select('id').eq('id', step.P2)) as unknown[]).length).toBe(0);
    const lead = ok(await u.mgr.sb.from('step_assignees').select('user_id').eq('step_id', step.P2).eq('is_lead', true)) as { user_id: string }[];
    expect(lead.map((l) => l.user_id)).toEqual([u.e2.id]);
  });

  it('11. إسناد لجميع موظفي الإدارة', async () => {
    const n = ok(await u.mgr.sb.rpc('set_step_assignees', { p_step: step.A1, p_users: [], p_all: true, p_mode: 'individual', p_threshold: 100 })) as number;
    // ثلاثة موظفين + مدير الإدارة (قد يوجد غيرهم في قاعدة الاختبار من ملفات أخرى)
    expect(n).toBeGreaterThanOrEqual(4);
    for (const k of ['e1', 'e2', 'e3']) expect((ok(await u[k].sb.from('steps').select('id').eq('id', step.A1)) as unknown[]).length).toBe(1);
    expect((ok(await u.other.sb.from('steps').select('id').eq('id', step.A1)) as unknown[]).length).toBe(0);
  });

  it('11b. جميع موظفي الجمعية للمدير التنفيذي فقط، ويشمل الإسناد للجميع من يُضاف لاحقًا', async () => {
    expect((await u.mgr.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [], p_scope: 'org' })).error?.message).toMatch(/المدير التنفيذي/);
    // المدير التنفيذي يُسند لجميع موظفي الجمعية فيراها موظف إدارة أخرى والمدير التنفيذي نفسه
    ok(await u.ed.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [], p_scope: 'org' }));
    expect((ok(await u.other.sb.from('steps').select('id').eq('id', step.P1)) as unknown[]).length).toBe(1);
    const mine = ok(await u.ed.sb.from('step_assignees').select('user_id').eq('step_id', step.P1).eq('user_id', u.ed.id)) as unknown[];
    expect(mine).toHaveLength(1);
    expect(ok(await u.ed.sb.rpc('set_step_assignees', { p_step: step.P1, p_users: [u.e1.id], p_scope: 'none' }))).toBe(1);
  });

  it('13. المهمة المشتركة: سجل إنجاز واحد، وتعدد المكلفين لا يضاعف الإنجاز', async () => {
    const before = await deptProgress();
    expect(before.d.progress).toBe(0);
    // e1 يحاول الإكمال دون مخرج متحقق
    expect((await u.e1.sb.rpc('update_step_progress', { p_step: step.P2, p_status: 'completed', p_note: 'تم' })).error?.message).toMatch(/المخرج المتحقق/);
    ok(await u.e1.sb.rpc('update_step_progress', { p_step: step.P2, p_status: 'completed', p_note: 'أُنجز التصميم', p_output_achieved: 'ملفات الهوية v1' }));
    // الشريك يكرر الإكمال: لا يتغير شيء
    ok(await u.e2.sb.rpc('update_step_progress', { p_step: step.P2, p_status: 'completed', p_note: 'تأكيد', p_output_achieved: 'ملفات الهوية v1' }));
    const after = await deptProgress();
    // 40٪ من مشروع وزنه 60٪ = 24٪ للإدارة — مرة واحدة فقط
    expect(after.d.progress).toBe(24);
    const counts = orgCounts(after.org, (await loadYearProgress(u.ed.sb, YEAR)).plans.filter((p) => p.quarter === 4));
    expect(counts.tasks.total).toBe(5);
    expect(counts.tasks.completed).toBe(1);
    expect(counts.works).toMatchObject({ total: 2, projects: 1, activities: 1 });
    // سجل التحديثات يحفظ من حدّث
    const ups = ok(await u.mgr.sb.from('step_updates').select('user_id').eq('step_id', step.P2)) as { user_id: string }[];
    expect(ups.map((x) => x.user_id)).toContain(u.e1.id);
  });

  it('13b. المهمة الفردية: كل مكلف يسجل إنجازه، ولا يغلقها شخص واحد، وتكتمل بالقاعدة الجماعية', async () => {
    // التحديث المشترك مرفوض في الوضع الفردي
    expect((await u.e1.sb.rpc('update_step_progress', { p_step: step.A1, p_status: 'completed', p_note: 'x', p_output_achieved: 'x' })).error).toBeTruthy();
    // الموظف لا يسجل عن زميله
    expect((await u.e1.sb.rpc('set_assignee_progress', { p_step: step.A1, p_done: true, p_note: 'عن زميلي', p_user: u.e2.id })).error?.message).toMatch(/مدير الإدارة/);
    // الإكمال يتطلب وصف ما أُنجز
    expect((await u.e1.sb.rpc('set_assignee_progress', { p_step: step.A1, p_done: true })).error).toBeTruthy();
    const total = (ok(await u.mgr.sb.from('step_assignees').select('user_id').eq('step_id', step.A1)) as unknown[]).length;
    const p1 = Number(ok(await u.e1.sb.rpc('set_assignee_progress', { p_step: step.A1, p_done: true, p_note: 'كتبت قسمي' })));
    expect(p1).toBeCloseTo(100 / total, 1);
    const st = ok(await u.mgr.sb.from('steps').select('status').eq('id', step.A1).single()) as { status: string };
    expect(st.status).toBe('in_progress');
    // خفض العتبة إلى 50٪ مسموح قبل… لا: تغيير النوع بعد البدء ممنوع، والعتبة تُعدل
    expect((await u.mgr.sb.rpc('set_step_assignees', { p_step: step.A1, p_users: [], p_all: true, p_mode: 'shared' })).error?.message).toMatch(/بعد بدء/);
    // بقية المكلفين ينجزون (المدير يسجل عن الباقين)
    const rest = ok(await u.mgr.sb.from('step_assignees').select('user_id').eq('step_id', step.A1).neq('user_id', u.e1.id)) as { user_id: string }[];
    for (const r of rest) ok(await u.mgr.sb.rpc('set_assignee_progress', { p_step: step.A1, p_done: true, p_note: 'أنجز', p_user: r.user_id }));
    const done = ok(await u.mgr.sb.from('steps').select('status,progress').eq('id', step.A1).single()) as { status: string; progress: number };
    expect(done.status).toBe('completed');
    expect(Number(done.progress)).toBe(100);
    // 50٪ من نشاط وزنه 40٪ = 20٪ + 24٪ سابقة
    expect((await deptProgress()).d.progress).toBe(44);
  });

  it('16. المخرج المطلوب والمتحقق والشواهد: الإرفاق وحده لا يُكمل المهمة', async () => {
    // سياسة «شاهد مطلوب»
    ok(await u.mgr.sb.rpc('set_step_output_policy', { p_step: step.P1, p_policy: 'evidence' }));
    ok(await u.e1.sb.rpc('save_step_output', { p_step: step.P1, p_output: 'كراسة الهوية النسخة الأولى' }));
    // رابط شاهد من المكلف
    const plan = ok(await u.e1.sb.from('steps').select('plan_id').eq('id', step.P1).single()) as { plan_id: string };
    ok(await u.e1.sb.from('evidence').insert({ step_id: step.P1, plan_id: plan.plan_id, kind: 'link', url: 'https://example.org/brand.pdf', file_name: 'الكراسة', uploaded_by: u.e1.id }));
    let s = ok(await u.e1.sb.from('steps').select('status,progress,output,output_achieved').eq('id', step.P1).single()) as { status: string; output: string; output_achieved: string };
    expect(s.status).toBe('not_started'); // الإرفاق لا يكمل
    expect(s.output).toBe('كراسة الهوية');
    expect(s.output_achieved).toBe('كراسة الهوية النسخة الأولى');
    // غير المكلف لا يرفق
    expect((await u.e3.sb.from('evidence').insert({ step_id: step.P1, plan_id: plan.plan_id, kind: 'link', url: 'https://example.org/x', file_name: 'x', uploaded_by: u.e3.id })).error).toBeTruthy();
    ok(await u.e1.sb.rpc('update_step_progress', { p_step: step.P1, p_status: 'completed', p_note: 'سُلمت الكراسة' }));
    s = ok(await u.e1.sb.from('steps').select('status').eq('id', step.P1).single()) as { status: string; output: string; output_achieved: string };
    expect(s.status).toBe('completed');

    // مهمة بسياسة شاهد دون شاهد: لا تكتمل
    ok(await u.mgr.sb.rpc('set_step_output_policy', { p_step: step.P3, p_policy: 'evidence' }));
    expect((await u.mgr.sb.rpc('update_step_progress', { p_step: step.P3, p_status: 'completed', p_note: 'x', p_output_achieved: 'منشور' })).error?.message).toMatch(/شاهد/);
    // مهمة لا تتطلب مرفقات
    ok(await u.mgr.sb.rpc('set_step_output_policy', { p_step: step.A2, p_policy: 'none' }));
    ok(await u.mgr.sb.rpc('update_step_progress', { p_step: step.A2, p_status: 'completed' }));
  });

  it('7/8. تعديل الأوزان بعد الاعتماد بإصدار موثق، والإنجاز يُعاد احتسابه صحيحًا', async () => {
    const before = (await deptProgress()).d.progress!;
    // P1 (30) + P2 (40) مكتملة = 70٪ من المشروع؛ A1 + A2 = 100٪ من النشاط
    expect(before).toBe(0.7 * 60 + 1 * 40);
    // التعديل المباشر ممنوع
    expect((await u.mgr.sb.from('activities').update({ weight: 50 }).eq('id', act.P)).error).toBeTruthy();
    const payload = { activities: [{ id: act.P, weight: 50 }, { id: act.A, weight: 50 }], steps: [] };
    const req = ok(await u.mgr.sb.rpc('request_plan_change', { p_plan: planId, p_kind: 'weights', p_payload: payload, p_reason: 'إعادة موازنة' })) as string;
    // مدير الإدارة لا يعتمد طلبه
    expect((await u.mgr.sb.rpc('decide_plan_change', { p_request: req, p_approve: true })).error).toBeTruthy();
    ok(await u.ed.sb.rpc('decide_plan_change', { p_request: req, p_approve: true, p_note: 'موافقة' }));
    const after = (await deptProgress()).d.progress!;
    expect(after).toBe(0.7 * 50 + 1 * 50);
    const log = ok(await u.ed.sb.from('change_requests').select('status').eq('id', req).single()) as { status: string };
    expect(log.status).toBe('approved');
  });

  it('1-6. رابط العرض: إنشاء للمدير التنفيذي فقط، فتح دون حساب، لا تسريب، إلغاء وانتهاء ورمز', async () => {
    const token = randomBytes(32).toString('base64url');
    // مدير الإدارة لا ينشئ روابط
    expect((await u.mgr.sb.from('share_links').insert({ token, name: 'x' })).error).toBeTruthy();
    const link = ok(
      await u.ed.sb.from('share_links').insert({ token, name: 'شاشة الاختبار', follow_current: false, year: YEAR, quarter: 4, show_activities: false }).select('id').single(),
    ) as { id: string };
    // الزائر لا يقرأ الجدول ولا الدوال الداخلية
    expect((await anon.from('share_links').select('*')).error).toBeTruthy();
    expect((await anon.rpc('get_progress_facts', { p_year: YEAR })).error).toBeTruthy();
    expect((await anon.from('steps').select('id')).error).toBeTruthy();
    // رمز قصير أو مزيف
    expect((ok(await anon.rpc('share_dashboard', { p_token: 'short' })) as { ok: boolean }).ok).toBe(false);
    expect((ok(await anon.rpc('share_dashboard', { p_token: randomBytes(32).toString('base64url') })) as { reason: string }).reason).toBe('invalid');

    const raw = ok(await anon.rpc('share_dashboard', { p_token: token })) as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    const text = JSON.stringify(raw);
    for (const leak of ['v2 e1', 'output', 'note', 'assignee', 'email', 'responsible', 'كراسة الهوية', 'مشروع الهوية الرقمية', token]) expect(text).not.toContain(leak);
    const view = buildShareView(raw);
    if (!view.ok) throw new Error('view');
    const d = view.ops!.depts.find((x) => x.id === dept.COMM)!;
    expect(d.progress).toBe(0.7 * 50 + 1 * 50);
    expect(d.counts.tasks.total).toBe(5);
    expect(d.counts.works.total).toBe(2);
    expect(d.activities).toBeUndefined();

    // رمز وصول وقفل بعد المحاولات الخاطئة
    ok(await u.ed.sb.rpc('set_share_link_code', { p_id: link.id, p_code: 'Board-2028' }));
    expect((ok(await anon.rpc('share_dashboard', { p_token: token })) as { reason: string }).reason).toBe('code_required');
    expect((ok(await anon.rpc('share_check', { p_token: token, p_code: 'wrong' })) as { reason: string }).reason).toBe('code_invalid');
    expect((ok(await anon.rpc('share_check', { p_token: token, p_code: 'Board-2028' })) as { ok: boolean }).ok).toBe(true);
    for (let i = 0; i < 8; i++) await anon.rpc('share_check', { p_token: token, p_code: `bad-${i}` });
    expect((ok(await anon.rpc('share_check', { p_token: token, p_code: 'Board-2028' })) as { reason: string }).reason).toBe('locked');
    ok(await u.ed.sb.rpc('set_share_link_code', { p_id: link.id, p_code: null }));
    expect((ok(await anon.rpc('share_dashboard', { p_token: token })) as { ok: boolean }).ok).toBe(true);

    // انتهاء الصلاحية
    ok(await u.ed.sb.from('share_links').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', link.id));
    expect((ok(await anon.rpc('share_dashboard', { p_token: token })) as { reason: string }).reason).toBe('expired');
    ok(await u.ed.sb.from('share_links').update({ expires_at: null }).eq('id', link.id));
    // الإيقاف ثم الإلغاء
    ok(await u.ed.sb.from('share_links').update({ is_active: false }).eq('id', link.id));
    expect((ok(await anon.rpc('share_dashboard', { p_token: token })) as { reason: string }).reason).toBe('invalid');
    ok(await u.ed.sb.from('share_links').update({ is_active: true, revoked_at: new Date().toISOString() }).eq('id', link.id));
    expect((ok(await anon.rpc('share_dashboard', { p_token: token })) as { reason: string }).reason).toBe('invalid');
    // عدّاد المشاهدات يعمل ولا يُخزن الرمز في سجل التغييرات
    const v = ok(await u.ed.sb.from('share_links').select('view_count').eq('id', link.id).single()) as { view_count: number };
    expect(v.view_count).toBeGreaterThan(0);
    const audit = ok(await admin.from('audit_log').select('new_data,old_data').eq('table_name', 'share_links').eq('record_id', link.id)) as unknown[];
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('17/18. الحسابات: لا يُلغي المستخدم اشتراط تغيير كلمة المرور بنفسه', async () => {
    ok(await admin.from('profiles').update({ must_change_password: true }).eq('id', u.e3.id));
    expect((await u.e3.sb.from('profiles').update({ must_change_password: false }).eq('id', u.e3.id)).error?.message).toMatch(/مباشرة/);
    // بعد تغيير كلمة المرور فعلًا تُلغى العلامة عبر الدالة
    const up = await u.e3.sb.auth.updateUser({ password: 'New-Strong-Pass-2028' });
    expect(up.error).toBeNull();
    ok(await u.e3.sb.rpc('clear_must_change_password'));
    const p = ok(await u.e3.sb.from('profiles').select('must_change_password').eq('id', u.e3.id).single()) as { must_change_password: boolean };
    expect(p.must_change_password).toBe(false);
  });

  it('20. التوافق: التفويض بالطريقة القديمة (assignee_id) ينعكس في جدول المكلفين', async () => {
    ok(await u.mgr.sb.from('steps').update({ assignee_id: u.e3.id }).eq('id', step.P3));
    const a = ok(await u.mgr.sb.from('step_assignees').select('user_id').eq('step_id', step.P3)) as { user_id: string }[];
    expect(a.map((x) => x.user_id)).toEqual([u.e3.id]);
    expect((ok(await u.e3.sb.from('steps').select('id').eq('id', step.P3)) as unknown[]).length).toBe(1);
  });
});
