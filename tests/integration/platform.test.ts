/**
 * اختبارات تكامل على قاعدة بيانات Supabase حقيقية (Auth + PostgREST + Storage + RLS).
 * تُشغَّل على بيئة اختبار فارغة فقط — تنشئ مستخدمين وبيانات وتحذف المستخدمين في النهاية.
 *
 *   TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_KEY=... npm run test:integration
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseOperationalWorkbook, matchDepartment, type ParsedWorkbook } from '../../src/lib/import/operational';
import { buildPlanProposal, createPlanFromProposal, applyReimport } from '../../src/lib/import/apply';
import { diffPlan } from '../../src/lib/import/diff';
import { evaluateQuarter, loadYearProgress } from '../../src/lib/data/progress';

const URL = process.env.TEST_SUPABASE_URL;
const ANON = process.env.TEST_SUPABASE_ANON_KEY!;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_KEY!;
const run = URL ? describe : describe.skip;
const PASSWORD = 'Test-Password-2026!';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let admin: SupabaseClient;
const users: Record<string, { id: string; sb: SupabaseClient }> = {};
const dept: Record<string, string> = {};
const createdUserIds: string[] = [];
let wb: ParsedWorkbook;
const planIds: Record<string, string> = {};

async function makeUser(key: string, role: string, deptCode?: string, name?: string) {
  const email = `${key}.${Date.now()}@test.rawasim.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name ?? key },
    app_metadata: { role, department_id: deptCode ? dept[deptCode] : null },
  });
  if (error) throw error;
  createdUserIds.push(data.user!.id);
  const sb = createClient(URL!, ANON, opts);
  const { error: e2 } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  users[key] = { id: data.user!.id, sb };
}

const ok = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

run('المنصة على قاعدة بيانات حقيقية', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE, opts);
    const d = ok(await admin.from('departments').select('id,code'));
    for (const x of d as { id: string; code: string }[]) dept[x.code] = x.id;
    await makeUser('ed', 'executive_director', undefined, 'المدير التنفيذي');
    await makeUser('mgrExec', 'dept_manager', 'EXEC');
    await makeUser('mgrProj', 'dept_manager', 'PROJ');
    await makeUser('mgrSupp', 'dept_manager', 'SUPP');
    await makeUser('mgrComm', 'dept_manager', 'COMM');
    await makeUser('mgrTmkn', 'dept_manager', 'TMKN');
    await makeUser('empComm', 'employee', 'COMM', 'رشيد');
    await makeUser('empComm2', 'employee', 'COMM');
    await makeUser('board', 'board_member');
    await makeUser('sysadmin', 'system_admin');
    wb = await parseOperationalWorkbook(readFileSync(path.join(__dirname, '../fixtures/q4-2026-plan.xlsx')));
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  // 1. إنشاء سنة جديدة
  it('1. إنشاء سنة جديدة (للمدير التنفيذي فقط)', async () => {
    const denied = await users.mgrExec.sb.rpc('create_year', { p_year: 2027 });
    expect(denied.error?.message).toMatch(/صلاحية المدير التنفيذي/);
    ok(await users.ed.sb.rpc('create_year', { p_year: 2027 }));
    const weeks = ok(await users.ed.sb.from('quarter_weeks').select('*').eq('year', 2027)) as unknown[];
    expect(weeks).toHaveLength(48);
    const w = ok(await users.ed.sb.rpc('get_dept_weights', { p_year: 2027 })) as { weight: number }[];
    expect(w).toHaveLength(5);
    expect(w.every((x) => Number(x.weight) === 20)).toBe(true);
  });

  // 2. خطة تنفيذية سنوية
  it('2. إنشاء خطة تنفيذية سنوية بمؤشرات ومستهدفات', async () => {
    const sb = users.ed.sb;
    const plan = ok(await sb.from('exec_plans').insert({ year: 2027, title: 'الخطة التنفيذية 2027', created_by: users.ed.id }).select('id').single()) as { id: string };
    const axis = ok(await sb.from('exec_axes').insert({ plan_id: plan.id, title: 'تمكين الطفل', sort_order: 1 }).select('id').single()) as { id: string };
    const goal = ok(await sb.from('exec_goals').insert({ plan_id: plan.id, axis_id: axis.id, title: 'رفع أثر البرامج' }).select('id').single()) as { id: string };
    const kpi = ok(
      await sb
        .from('kpis')
        .insert({ plan_id: plan.id, goal_id: goal.id, name: 'عدد المستفيدين', unit: 'طفل', kpi_type: 'numeric', direction: 'increase', annual_target: 400, department_id: dept.PROJ })
        .select('id')
        .single(),
    ) as { id: string };
    ok(await sb.from('kpi_period_targets').insert([1, 2, 3, 4].map((q) => ({ kpi_id: kpi.id, quarter: q, target: q * 100 }))));
    // المجلس لا يرى المسودة
    const boardView = ok(await users.board.sb.from('exec_plans').select('id').eq('year', 2027)) as unknown[];
    expect(boardView).toHaveLength(0);
    ok(await sb.from('exec_plans').update({ status: 'approved', approved_by: users.ed.id, approved_at: new Date().toISOString() }).eq('id', plan.id));
    expect((ok(await users.board.sb.from('kpis').select('id').eq('plan_id', plan.id)) as unknown[]).length).toBe(1);
    // مدير الإدارة المسؤولة يسجل قياسًا، ومدير آخر لا يستطيع
    ok(await users.mgrProj.sb.from('kpi_measurements').insert({ kpi_id: kpi.id, value: 120, quarter: 1, recorded_by: users.mgrProj.id }));
    const bad = await users.mgrComm.sb.from('kpi_measurements').insert({ kpi_id: kpi.id, value: 999, quarter: 1, recorded_by: users.mgrComm.id });
    expect(bad.error).toBeTruthy();
    // المجلس للقراءة فقط
    const boardWrite = await users.board.sb.from('kpis').update({ annual_target: 1 }).eq('id', kpi.id).select();
    expect(boardWrite.data ?? []).toHaveLength(0);
  });

  // 3-6. الاستيراد
  it('3-6. استيراد الملف المرفق، التعرف على الإدارات الأربع، وإضافة تمكين', async () => {
    const depts = ok(await users.ed.sb.from('departments').select('id,name,short_name')) as { id: string; name: string; short_name: string }[];
    expect(wb.sheets).toHaveLength(4);
    const codeById = Object.fromEntries(Object.entries(dept).map(([k, v]) => [v, k]));
    for (const s of wb.sheets) {
      const m = matchDepartment(s.departmentHint, s.sheetName, depts)!;
      const code = codeById[m.id];
      const proposal = buildPlanProposal(s.activities, 4, { activityWeightMode: 'nature', recurringCycles: true });
      // كل مدير يستورد خطة إدارته؛ ومدير إدارة أخرى يُمنع
      if (code === 'COMM') {
        await expect(
          createPlanFromProposal(users.mgrExec.sb, { year: 2026, quarter: 4, departmentId: m.id, proposal }),
        ).rejects.toThrow();
      }
      const mgr = { EXEC: users.mgrExec, PROJ: users.mgrProj, SUPP: users.mgrSupp, COMM: users.mgrComm }[code as 'EXEC']!;
      planIds[code] = await createPlanFromProposal(mgr.sb, { year: 2026, quarter: 4, departmentId: m.id, proposal });
    }
    expect(Object.keys(planIds).sort()).toEqual(['COMM', 'EXEC', 'PROJ', 'SUPP']);
    const steps = ok(await users.ed.sb.from('steps').select('id', { count: 'exact', head: false }).in('plan_id', Object.values(planIds))) as unknown[];
    expect(steps).toHaveLength(16 + 19 + 20 + 53);

    // 5. إدارة تمكين: خطة يدوية
    const sb = users.mgrTmkn.sb;
    const plan = ok(await sb.from('op_plans').insert({ year: 2026, quarter: 4, department_id: dept.TMKN, created_by: users.mgrTmkn.id }).select('id').single()) as { id: string };
    const a = ok(await sb.from('activities').insert({ plan_id: plan.id, seq: 1, title: 'برنامج تمكين القادة', kind: 'project', weight: 100 }).select('id').single()) as { id: string };
    const st = ok(
      await sb
        .from('steps')
        .insert([
          { activity_id: a.id, plan_id: plan.id, seq: 1, title: 'تصميم البرنامج', weight: 60, is_core: false, responsible_text: 'مدير تمكين' },
          { activity_id: a.id, plan_id: plan.id, seq: 2, title: 'تنفيذ البرنامج', weight: 40, is_core: true, responsible_text: 'فريق تمكين' },
        ])
        .select('id,seq'),
    ) as { id: string; seq: number }[];
    ok(await sb.from('step_weeks').insert([{ step_id: st[0].id, week_index: 1 }, { step_id: st[1].id, week_index: 2 }, { step_id: st[1].id, week_index: 3 }]));
    planIds.TMKN = plan.id;
  });

  it('6. الأنشطة والخطوات والمسؤولون والمخرجات محفوظة كما في الملف', async () => {
    const s = ok(
      await users.mgrProj.sb.from('steps').select('title,responsible_text,output,weight,is_core,import_followup,activities(title)').eq('plan_id', planIds.PROJ).eq('title', 'تنفيذ المشروع'),
    ) as { responsible_text: string; output: string; weight: number; is_core: boolean }[];
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ responsible_text: 'فريق الأشبال', output: 'تقرير تنفيذ المشروع', is_core: true });
    expect(Number(s[0].weight)).toBe(40);
    const followups = ok(await users.mgrExec.sb.from('steps').select('import_followup,status,progress').eq('plan_id', planIds.EXEC).not('import_followup', 'is', null)) as {
      status: string;
      progress: number;
    }[];
    expect(followups.length).toBeGreaterThan(0);
    expect(followups.every((f) => f.status === 'not_started' && Number(f.progress) === 0)).toBe(true);
  });

  // 7 + 15. الجدولة إلى مهام دون تكرار
  it('7/15. الجدولة الأسبوعية = سجل واحد للخطوة بعدة أسابيع', async () => {
    const st = ok(await users.mgrSupp.sb.from('steps').select('id,title,step_weeks(week_index)').eq('plan_id', planIds.SUPP).ilike('title', '%جدول الحجوزات الأسبوعي%')) as {
      id: string;
      step_weeks: { week_index: number }[];
    }[];
    expect(st).toHaveLength(1);
    expect(st[0].step_weeks).toHaveLength(11);
  });

  // 8-9. الأوزان والاعتماد
  it('8-9. منع الرفع والاعتماد بأوزان غير مكتملة، ثم الاعتماد بعد التصحيح', async () => {
    const sb = users.mgrTmkn.sb;
    // تعديل وزن ليصبح المجموع 90
    const steps = ok(await sb.from('steps').select('id,weight').eq('plan_id', planIds.TMKN).order('seq')) as { id: string }[];
    ok(await sb.from('steps').update({ weight: 50 }).eq('id', steps[0].id));
    const r = await sb.rpc('submit_plan', { p_plan: planIds.TMKN });
    expect(r.error?.message).toMatch(/مجموع أوزان خطوات/);
    const r2 = await users.ed.sb.rpc('approve_plan', { p_plan: planIds.TMKN });
    expect(r2.error?.message).toMatch(/لا يمكن اعتماد الخطة/);
    ok(await sb.from('steps').update({ weight: 60 }).eq('id', steps[0].id));
    ok(await sb.rpc('submit_plan', { p_plan: planIds.TMKN }));
    // مدير الإدارة لا يعتمد
    expect((await sb.rpc('approve_plan', { p_plan: planIds.TMKN })).error?.message).toMatch(/صلاحية المدير التنفيذي/);
    ok(await users.ed.sb.rpc('approve_plan', { p_plan: planIds.TMKN }));
  });

  it('9. أوزان الأنشطة المستوردة = 100 والخطوة الجوهرية 40٪', async () => {
    for (const code of ['EXEC', 'PROJ', 'SUPP', 'COMM']) {
      const issues = ok(await users.ed.sb.rpc('plan_weight_issues', { p_plan: planIds[code] })) as unknown[];
      expect(issues).toEqual([]);
      ok(await users.ed.sb.rpc('approve_plan', { p_plan: planIds[code] }));
    }
    const cores = ok(await users.ed.sb.from('steps').select('weight,activity_id').eq('is_core', true).in('plan_id', Object.values(planIds))) as { weight: number }[];
    expect(cores.length).toBeGreaterThan(20);
    expect(cores.filter((c) => Number(c.weight) === 40).length / cores.length).toBeGreaterThan(0.7);
  });

  // 10-13. الاحتساب والتحديث
  it('10-13. الاحتساب: نشاط ← إدارة ← جمعية، وأثر التحديث المباشر', async () => {
    const before = evaluateQuarter(await loadYearProgress(users.board.sb, 2026), 4, { asOf: '2026-10-15' });
    expect(before.computable).toBe(true); // الإدارات الخمس معتمدة
    expect(before.progress).toBe(0);

    // تمكين: إكمال الخطوة الأولى (60٪ من نشاط وزنه 100) = 60٪ للإدارة = 12٪ للجمعية
    const st = ok(await users.mgrTmkn.sb.from('steps').select('id').eq('plan_id', planIds.TMKN).order('seq')) as { id: string }[];
    const p = ok(await users.mgrTmkn.sb.rpc('update_step_progress', { p_step: st[0].id, p_status: 'completed', p_note: 'تم تصميم البرنامج', p_actual_output: 'برنامج معتمد' }));
    expect(Number(p)).toBe(100);
    const after = evaluateQuarter(await loadYearProgress(users.board.sb, 2026), 4, { asOf: '2026-10-15' });
    const tm = after.departments.find((d) => d.departmentId === dept.TMKN)!;
    expect(tm.progress).toBe(60);
    expect(after.progress).toBe(12);

    // بدء الخطوة دون إكمال لا يضيف إنجازًا
    ok(await users.mgrTmkn.sb.rpc('update_step_progress', { p_step: st[1].id, p_status: 'in_progress' }));
    const mid = evaluateQuarter(await loadYearProgress(users.board.sb, 2026), 4, { asOf: '2026-10-15' });
    expect(mid.progress).toBe(12);
  });

  it('12. المراحل الفرعية (دورات شهرية) تحتسب بأوزانها', async () => {
    const st = ok(
      await users.mgrSupp.sb.from('steps').select('id,weight,substeps(id,weight,sort_order)').eq('plan_id', planIds.SUPP).eq('title', 'طلب عهدة شهرية').single(),
    ) as { id: string; substeps: { id: string; sort_order: number }[] };
    expect(st.substeps).toHaveLength(3);
    const first = st.substeps.sort((a, b) => a.sort_order - b.sort_order)[0].id;
    const p = ok(await users.mgrSupp.sb.rpc('update_step_progress', { p_step: st.id, p_status: 'in_progress', p_done_substeps: [first] }));
    expect(Number(p)).toBeCloseTo(33.33, 1);
    const bad = await users.mgrSupp.sb.rpc('update_step_progress', { p_step: st.id, p_status: 'completed', p_done_substeps: [first] });
    expect(bad.error?.message).toMatch(/مراحلها الفرعية/);
  });

  // 16-17. مدير الإدارة والتفويض
  it('16-17. مدير الإدارة يفوض موظفًا، والموظف يرى مهامه فقط ويحدثها', async () => {
    const steps = ok(await users.mgrComm.sb.from('steps').select('id,title').eq('plan_id', planIds.COMM).order('seq').limit(2)) as { id: string }[];
    // تفويض موظف من إدارة أخرى مرفوض
    const foreign = await users.mgrComm.sb.from('steps').update({ assignee_id: users.mgrExec.id }).eq('id', steps[0].id);
    expect(foreign.error?.message).toMatch(/الإدارة نفسها/);
    ok(await users.mgrComm.sb.from('steps').update({ assignee_id: users.empComm.id }).eq('id', steps[0].id));

    const mine = ok(await users.empComm.sb.from('steps').select('id')) as { id: string }[];
    expect(mine.map((s) => s.id)).toEqual([steps[0].id]);
    const otherPlans = ok(await users.empComm.sb.from('op_plans').select('id')) as { id: string }[];
    expect(otherPlans.map((p) => p.id)).toEqual([planIds.COMM]);
    expect((ok(await users.empComm2.sb.from('steps').select('id')) as unknown[]).length).toBe(0);

    ok(await users.empComm.sb.rpc('update_step_progress', { p_step: steps[0].id, p_status: 'completed', p_note: 'أنجزت', p_actual_output: 'تم النشر' }));
    const denied = await users.empComm.sb.rpc('update_step_progress', { p_step: steps[1].id, p_status: 'completed' });
    expect(denied.error?.message).toMatch(/لا تملك صلاحية/);
    // الموظف لا يغير حالته أو دوره
    const esc = await users.empComm.sb.from('profiles').update({ role: 'executive_director' }).eq('id', users.empComm.id);
    expect(esc.error?.message).toMatch(/صلاحية/);
  });

  it('رفع الشاهد: للمكلف فقط، والتخزين يرفض غير المصرح', async () => {
    const step = ok(await users.empComm.sb.from('steps').select('id,plan_id').single()) as { id: string; plan_id: string };
    const file = new Blob(['evidence'], { type: 'text/plain' });
    const pathOk = `${step.plan_id}/${step.id}/محضر.txt`.replace(/[^\w./-]/g, '_');
    ok(await users.empComm.sb.storage.from('evidence').upload(pathOk, file));
    ok(await users.empComm.sb.from('evidence').insert({ step_id: step.id, plan_id: step.plan_id, storage_path: pathOk, file_name: 'محضر.txt', uploaded_by: users.empComm.id }));
    const other = ok(await users.mgrComm.sb.from('steps').select('id').eq('plan_id', planIds.COMM).neq('id', step.id).limit(1).single()) as { id: string };
    const bad = await users.empComm.sb.storage.from('evidence').upload(`${step.plan_id}/${other.id}/x.txt`, file);
    expect(bad.error).toBeTruthy();
    expect((ok(await users.empComm2.sb.from('evidence').select('id')) as unknown[]).length).toBe(0);
    const dl = await users.mgrComm.sb.storage.from('evidence').download(pathOk);
    expect(dl.error).toBeNull();
  });

  // 18. مجلس الإدارة
  it('18. مجلس الإدارة: قراءة الخطط المعتمدة فقط دون تعديل', async () => {
    const plans = ok(await users.board.sb.from('op_plans').select('id,status').eq('year', 2026)) as { status: string }[];
    expect(plans.length).toBe(5);
    expect(plans.every((p) => p.status === 'approved')).toBe(true);
    const upd = await users.board.sb.from('steps').update({ responsible_text: 'x' }).eq('plan_id', planIds.EXEC).select();
    expect(upd.data ?? []).toHaveLength(0);
    const rpc = await users.board.sb.rpc('update_step_progress', { p_step: (ok(await users.board.sb.from('steps').select('id').limit(1).single()) as { id: string }).id, p_status: 'completed' });
    expect(rpc.error).toBeTruthy();
    expect((ok(await users.board.sb.from('audit_log').select('id').limit(1)) as unknown[]).length).toBe(0);
  });

  // 19. مركز المتابعة التنفيذية
  it('19. التوجيهات وطلبات التدخل', async () => {
    const d = ok(
      await users.ed.sb
        .from('directives')
        .insert({ title: 'تسريع تأسيس الفريق الإعلامي', target_type: 'department', department_id: dept.COMM, assignee_id: users.mgrComm.id, due_date: '2026-11-01', created_by: users.ed.id })
        .select('id')
        .single(),
    ) as { id: string };
    expect((ok(await users.mgrComm.sb.from('directives').select('id')) as unknown[]).length).toBe(1);
    expect((ok(await users.mgrExec.sb.from('directives').select('id')) as unknown[]).length).toBe(0);
    expect((ok(await users.board.sb.from('directives').select('id')) as unknown[]).length).toBe(0);
    expect((await users.mgrComm.sb.rpc('update_directive', { p_directive: d.id, p_status: 'closed', p_note: 'تم' })).error).toBeTruthy();
    ok(await users.mgrComm.sb.rpc('update_directive', { p_directive: d.id, p_status: 'in_progress', p_note: 'بدأنا' }));
    ok(await users.ed.sb.rpc('update_directive', { p_directive: d.id, p_status: 'closed', p_note: 'أُغلق' }));
    const ins = await users.mgrExec.sb.from('directives').insert({ title: 'x', created_by: users.mgrExec.id });
    expect(ins.error).toBeTruthy();
    ok(await users.mgrComm.sb.from('escalations').insert({ kind: 'decision', department_id: dept.COMM, title: 'اعتماد ميزانية المصمم الخارجي', raised_by: users.mgrComm.id }));
    expect((ok(await users.ed.sb.from('escalations').select('id')) as unknown[]).length).toBe(1);
    expect((ok(await users.mgrExec.sb.from('escalations').select('id')) as unknown[]).length).toBe(0);
  });

  // 20-21. التقارير
  it('20-21. التقرير يحفظ نسخة ثابتة ولا يتغير بعد الاعتماد', async () => {
    const r = ok(
      await users.ed.sb.from('reports').insert({ type: 'quarterly', year: 2026, quarter: 4, title: 'تقرير الربع الرابع', snapshot: { org: { progress: 12 } } }).select('id,status').single(),
    ) as { id: string; status: string };
    expect(r.status).toBe('draft');
    expect((ok(await users.board.sb.from('reports').select('id')) as unknown[]).length).toBe(0);
    const tamper = await users.ed.sb.from('reports').update({ snapshot: { org: { progress: 99 } } }).eq('id', r.id);
    expect(tamper.error?.message).toMatch(/ثابتة/);
    ok(await users.ed.sb.from('reports').update({ director_comment: 'أداء مقبول', status: 'approved' }).eq('id', r.id));
    const after = await users.ed.sb.from('reports').update({ director_comment: 'تعديل' }).eq('id', r.id);
    expect(after.error?.message).toMatch(/معتمد/);
    expect((await users.ed.sb.from('reports').delete().eq('id', r.id)).error?.message).toMatch(/معتمد/);
    const seen = ok(await users.board.sb.from('reports').select('snapshot,approved_by').eq('id', r.id).single()) as { snapshot: { org: { progress: number } }; approved_by: string };
    expect(seen.snapshot.org.progress).toBe(12);
    expect(seen.approved_by).toBe(users.ed.id);
    // مدير إدارة لا يصدر تقريرًا لإدارة أخرى
    const bad = await users.mgrExec.sb.from('reports').insert({ type: 'monthly', year: 2026, month: 10, department_id: dept.COMM, title: 'x', snapshot: {} });
    expect(bad.error).toBeTruthy();
  });

  // 22. إعادة الاستيراد
  it('22. إعادة استيراد الملف دون فقد الإنجاز (طلب تعديل للخطة المعتمدة)', async () => {
    const sb = users.mgrComm.sb;
    const existing = ok(
      await sb.from('activities').select('id,title,steps(id,title,responsible_text,output,progress,status,step_weeks(week_index))').eq('plan_id', planIds.COMM).eq('is_archived', false),
    ) as { id: string; title: string; steps: { id: string; title: string; responsible_text: string; output: string; progress: number; status: string; step_weeks: { week_index: number }[] }[] }[];
    const sheet = structuredClone(wb.sheets[3]);
    sheet.activities[0].steps.push({ seq: 5, row: 99, title: 'نشر المصفوفة على الموظفين', responsible: 'رشيد', output: 'تعميم', followup: null, weeks: [5], intensities: {}, scheduleSource: 'marks' });
    sheet.activities[1].steps[0].weeks = [4, 5, 6];
    const diff = diffPlan(
      existing.map((a) => ({ id: a.id, title: a.title, steps: a.steps.map((s) => ({ ...s, weeks: s.step_weeks.map((w) => w.week_index) })) })),
      sheet.activities,
    );
    expect(diff.summary.addedActivities).toBe(0);
    expect(diff.summary.addedSteps).toBe(1);
    expect(diff.summary.changedSteps).toBe(1);
    const res = await applyReimport(sb, planIds.COMM, diff, 4, { applyAdded: true, applyChanged: true, removeMissing: true }, { activityWeightMode: 'nature', recurringCycles: true });
    expect(res.mode).toBe('change_request');
    const done = ok(await users.ed.sb.from('steps').select('id,progress').eq('plan_id', planIds.COMM).eq('status', 'completed')) as { id: string }[];
    ok(await users.ed.sb.rpc('decide_plan_change', { p_request: res.requestId, p_approve: true, p_note: 'موافق' }));
    const plan = ok(await users.ed.sb.from('op_plans').select('version').eq('id', planIds.COMM).single()) as { version: number };
    expect(plan.version).toBe(2);
    const doneAfter = ok(await users.ed.sb.from('steps').select('id,progress').eq('plan_id', planIds.COMM).eq('status', 'completed')) as { id: string }[];
    expect(doneAfter.map((x) => x.id)).toEqual(done.map((x) => x.id));
    expect((ok(await users.ed.sb.rpc('plan_weight_issues', { p_plan: planIds.COMM })) as unknown[]).length).toBe(0);
    const snaps = ok(await users.ed.sb.from('plan_weight_snapshots').select('version').eq('plan_id', planIds.COMM).order('version')) as { version: number }[];
    expect(snaps.map((s) => s.version)).toEqual([1, 2]);
  });

  // 24. منع الوصول غير المصرح
  it('24. منع الوصول غير المصرح وتعديل الأوزان بعد الاعتماد', async () => {
    const anon = createClient(URL!, ANON, opts);
    const anonRead = await anon.from('op_plans').select('id');
    expect(anonRead.error !== null || (anonRead.data ?? []).length === 0).toBe(true);
    expect((await anon.rpc('get_progress_facts', { p_year: 2026 })).error).toBeTruthy();
    const st = ok(await users.mgrExec.sb.from('steps').select('id').eq('plan_id', planIds.EXEC).limit(1).single()) as { id: string };
    expect((await users.mgrExec.sb.from('steps').update({ weight: 99 }).eq('id', st.id)).error?.message).toMatch(/معتمدة/);
    expect((await users.mgrExec.sb.from('steps').update({ progress: 100 }).eq('id', st.id)).error?.message).toMatch(/update_step_progress/);
    await users.mgrExec.sb.from('op_plans').update({ status: 'draft' }).eq('id', planIds.EXEC);
    expect(((ok(await users.ed.sb.from('op_plans').select('status').eq('id', planIds.EXEC).single())) as { status: string }).status).toBe('approved');
    // حتى المدير التنفيذي لا يغير الحالة مباشرة (يجب المرور بإجراء الاعتماد)
    await users.ed.sb.from('op_plans').update({ status: 'archived' }).eq('id', planIds.EXEC);
    expect(((ok(await users.ed.sb.from('op_plans').select('status').eq('id', planIds.EXEC).single())) as { status: string }).status).toBe('approved');
    // وعلى مسودة: المحفز يرفض تغيير الحالة مباشرة
    const draft = ok(await users.ed.sb.from('op_plans').insert({ year: 2027, quarter: 1, department_id: dept.EXEC, created_by: users.ed.id }).select('id').single()) as { id: string };
    expect((await users.ed.sb.from('op_plans').update({ status: 'approved' }).eq('id', draft.id)).error?.message).toMatch(/إجراءات الاعتماد/);
    expect((ok(await users.mgrExec.sb.from('steps').select('id').eq('plan_id', planIds.COMM)) as unknown[]).length).toBe(0);
    expect((ok(await users.mgrExec.sb.from('audit_log').select('id')) as unknown[]).length).toBe(0);
    expect((ok(await users.sysadmin.sb.from('audit_log').select('id').limit(1)) as unknown[]).length).toBe(1);
    expect((ok(await users.sysadmin.sb.from('steps').select('id').limit(1)) as unknown[]).length).toBe(0);
  });

  it('الحساب الذي لم يُسند له دور من الخادم يبقى معطلًا ولا يرى شيئًا', async () => {
    const email = `nobody.${Date.now()}@test.rawasim.local`;
    const { data } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    createdUserIds.push(data.user!.id);
    const sb = createClient(URL!, ANON, opts);
    await sb.auth.signInWithPassword({ email, password: PASSWORD });
    const me = ok(await sb.from('profiles').select('is_active').eq('id', data.user!.id).single()) as { is_active: boolean };
    expect(me.is_active).toBe(false);
    expect((ok(await sb.from('departments').select('id')) as unknown[]).length).toBe(0);
    expect((ok(await sb.rpc('get_progress_facts', { p_year: 2026 })) as unknown[]).length).toBe(0);
  });

  // 23. الانتقال لسنة جديدة والأرشفة
  it('23. أرشفة السنة تحفظ البيانات وتمنع التعديل', async () => {
    const before = evaluateQuarter(await loadYearProgress(users.ed.sb, 2026), 4, { asOf: '2026-10-15' });
    ok(await users.ed.sb.rpc('archive_year', { p_year: 2026 }));
    const after = evaluateQuarter(await loadYearProgress(users.ed.sb, 2026), 4, { asOf: '2026-10-15' });
    expect(after.progress).toBe(before.progress);
    const st = ok(await users.mgrTmkn.sb.from('steps').select('id').eq('plan_id', planIds.TMKN).order('seq').limit(1).single()) as { id: string };
    expect((await users.mgrTmkn.sb.rpc('update_step_progress', { p_step: st.id, p_status: 'not_started' })).error).toBeTruthy();
    const years = ok(await users.ed.sb.from('years').select('year,status').in('year', [2026, 2027]).order('year')) as { year: number; status: string }[];
    expect(years).toEqual([
      { year: 2026, status: 'archived' },
      { year: 2027, status: 'planning' },
    ]);
  });
});
