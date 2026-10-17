/**
 * بيانات تجريبية للتطوير المحلي فقط — لا تُشغَّل على قاعدة بيانات الجمعية الفعلية.
 * - حسابات تجريبية بنطاق @demo.rawasim.local وكلمة مرور موحدة.
 * - تستورد خطط الربع الرابع 2026 من الملف المرجعي، وتعتمدها.
 * - تسجل تحديثات إنجاز «تجريبية» مكتوب في ملاحظتها [تجريبي].
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/local-dev/seed-demo.ts
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseOperationalWorkbook, matchDepartment } from '../../src/lib/import/operational';
import { buildPlanProposal, createPlanFromProposal } from '../../src/lib/import/apply';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'Demo-Rawasim-2026';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

if (!URL.includes('127.0.0.1') && !URL.includes('localhost') && !process.argv.includes('--i-know')) {
  console.error('هذا السكربت للبيئة المحلية فقط.');
  process.exit(1);
}

async function main() {
  const admin = createClient(URL, SERVICE, opts);
  const { data: depts } = await admin.from('departments').select('id,code,name,short_name');
  const d = Object.fromEntries((depts ?? []).map((x) => [x.code, x.id]));

  const users: Record<string, SupabaseClient> = {};
  const ids: Record<string, string> = {};
  const mk = async (key: string, name: string, role: string, dept?: string, title?: string) => {
    const email = `${key}@demo.rawasim.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: name },
      app_metadata: { role, department_id: dept ? d[dept] : null },
    });
    if (error) throw error;
    ids[key] = data.user!.id;
    if (title) await admin.from('profiles').update({ job_title: title }).eq('id', data.user!.id);
    const sb = createClient(URL, ANON, opts);
    await sb.auth.signInWithPassword({ email, password: PASSWORD });
    users[key] = sb;
  };
  await mk('ed', 'المدير التنفيذي (تجريبي)', 'executive_director', undefined, 'المدير التنفيذي');
  await mk('exec', 'مدير الإدارة التنفيذية (تجريبي)', 'dept_manager', 'EXEC');
  await mk('proj', 'مدير المشاريع (تجريبي)', 'dept_manager', 'PROJ');
  await mk('supp', 'مدير الخدمات المساندة (تجريبي)', 'dept_manager', 'SUPP');
  await mk('comm', 'مدير الاتصال المؤسسي (تجريبي)', 'dept_manager', 'COMM');
  await mk('tmkn', 'مدير تمكين (تجريبي)', 'dept_manager', 'TMKN');
  await mk('rashid', 'موظف الاتصال (تجريبي)', 'employee', 'COMM', 'أخصائي اتصال');
  await mk('noura', 'نورة — مصممة (تجريبي)', 'employee', 'COMM', 'مصممة جرافيك');
  await mk('saad', 'سعد — منسق خدمات (تجريبي)', 'employee', 'SUPP', 'منسق خدمات');
  await mk('huda', 'هدى — أخصائية برامج (تجريبي)', 'employee', 'SUPP', 'أخصائية برامج');
  await mk('fahad', 'فهد — منسق مشاريع (تجريبي)', 'employee', 'PROJ', 'منسق مشاريع');
  await mk('board', 'عضو مجلس الإدارة (تجريبي)', 'board_member');
  await mk('admin', 'مسؤول النظام (تجريبي)', 'system_admin');

  const wb = await parseOperationalWorkbook(readFileSync('tests/fixtures/q4-2026-plan.xlsx'));
  const planIds: Record<string, string> = {};
  for (const s of wb.sheets) {
    const m = matchDepartment(s.departmentHint, s.sheetName, depts ?? [])!;
    const code = (depts ?? []).find((x) => x.id === m.id)!.code;
    const key = { EXEC: 'exec', PROJ: 'proj', SUPP: 'supp', COMM: 'comm' }[code as 'EXEC']!;
    const proposal = buildPlanProposal(s.activities, 4, { activityWeightMode: 'nature', recurringCycles: true });
    planIds[code] = await createPlanFromProposal(users[key], { year: 2026, quarter: 4, departmentId: m.id, proposal, title: s.title ?? undefined });
    await users[key].rpc('submit_plan', { p_plan: planIds[code] });
  }
  for (const code of ['EXEC', 'PROJ', 'SUPP']) {
    const { error } = await users.ed.rpc('approve_plan', { p_plan: planIds[code], p_note: 'اعتماد تجريبي' });
    if (error) throw error;
  }
  // الاتصال المؤسسي تبقى بانتظار الاعتماد لإظهار دورة الاعتماد

  // تحديثات تجريبية: الخطوات المجدولة في الأسبوعين الأولين من أكتوبر
  const { data: steps } = await admin
    .from('steps')
    .select('id,plan_id,title,step_weeks(week_index),substeps(id,sort_order)')
    .in('plan_id', [planIds.EXEC, planIds.PROJ, planIds.SUPP]);
  let n = 0;
  for (const s of steps ?? []) {
    const weeks = (s.step_weeks as { week_index: number }[]).map((w) => w.week_index);
    const max = Math.max(...weeks);
    const code = Object.entries(planIds).find(([, v]) => v === s.plan_id)![0];
    const sb = users[{ EXEC: 'exec', PROJ: 'proj', SUPP: 'supp' }[code as 'EXEC']!];
    const subs = (s.substeps as { id: string; sort_order: number }[]).sort((a, b) => a.sort_order - b.sort_order);
    if (subs.length && weeks.some((w) => w <= 3)) {
      await sb.rpc('update_step_progress', { p_step: s.id, p_status: 'in_progress', p_note: '[تجريبي] دورة أكتوبر', p_done_substeps: [subs[0].id] });
      n++;
    } else if (max <= 1 || (max === 2 && n % 3 !== 0)) {
      await sb.rpc('update_step_progress', { p_step: s.id, p_status: 'completed', p_note: '[تجريبي] أنجزت', p_actual_output: '[تجريبي] تحقق المخرج كما هو مخطط' });
      n++;
    } else if (weeks.includes(3)) {
      await sb.rpc('update_step_progress', { p_step: s.id, p_status: 'in_progress', p_note: '[تجريبي] قيد العمل' });
      n++;
    }
  }
  // إسناد: مكلف واحد، عدة مكلفين، وجميع موظفي الإدارة
  const { data: commSteps } = await admin.from('steps').select('id').eq('plan_id', planIds.COMM).ilike('responsible_text', '%رشيد%').limit(8);
  for (const s of commSteps ?? []) await users.comm.rpc('set_step_assignees', { p_step: s.id, p_users: [ids.rashid] });
  const { data: suppSteps } = await admin.from('steps').select('id,status').eq('plan_id', planIds.SUPP).neq('status', 'completed').order('seq').limit(6);
  for (const [i, s] of (suppSteps ?? []).entries()) {
    if (i < 3) await users.supp.rpc('set_step_assignees', { p_step: s.id, p_users: [ids.saad, ids.huda], p_lead: ids.saad, p_mode: 'collaborative' });
    else if (i === 3) await users.supp.rpc('set_step_assignees', { p_step: s.id, p_users: [], p_all_dept: true, p_mode: 'individual', p_threshold: 100 });
    else await users.supp.rpc('set_step_assignees', { p_step: s.id, p_users: [ids.huda] });
  }
  const { data: projSteps } = await admin.from('steps').select('id').eq('plan_id', planIds.PROJ).neq('status', 'completed').order('seq').limit(5);
  for (const s of projSteps ?? []) await users.proj.rpc('set_step_assignees', { p_step: s.id, p_users: [ids.fahad, ids.proj], p_lead: ids.fahad });

  await users.ed.from('directives').insert({
    title: '[تجريبي] مراجعة جدول المشتريات الدورية قبل نهاية أكتوبر',
    target_type: 'department',
    department_id: d.SUPP,
    assignee_id: ids.supp,
    due_date: '2026-10-29',
    created_by: ids.ed,
  });
  await users.proj.from('escalations').insert({ kind: 'decision', department_id: d.PROJ, title: '[تجريبي] اعتماد موازنة رحلة بادية رواسم', raised_by: ids.proj });

  // خطة تنفيذية تجريبية بمؤشرات وقياسات
  const ep = (await users.ed.from('exec_plans').insert({ year: 2026, title: 'الخطة التنفيذية 2026م (تجريبية)', created_by: ids.ed }).select('id').single()).data!;
  const axes = [
    ['بناء الشخصية المتوازنة', [['رفع أثر البرامج التربوية على المستفيدين', [['عدد المستفيدين من البرامج', 'مستفيد', 'numeric', 1200, 940], ['نسبة رضا المستفيدين', '%', 'percentage', 90, 89], ['عدد البرامج المنفذة', 'برنامج', 'numeric', 30, 27]]], ['توسيع الشراكات المجتمعية', [['عدد الشراكات الفاعلة', 'شراكة', 'numeric', 20, 19], ['ساعات التطوع', 'ساعة', 'numeric', 4000, 3500]]]]],
    ['التميز المؤسسي', [['رفع كفاءة الأداء التشغيلي', [['نسبة إنجاز الخطط التشغيلية', '%', 'percentage', 90, 62], ['متوسط زمن إغلاق طلبات الشراء', 'يوم', 'numeric', 5, 7]]], ['تنمية الموارد المالية', [['الإيرادات المحققة', 'ريال', 'financial', 2500000, 1400000]]]]],
  ] as const;
  let sort = 1;
  for (const [ai, [axisTitle, goals]] of axes.entries()) {
    const ax = (await users.ed.from('exec_axes').insert({ plan_id: ep.id, title: axisTitle, sort_order: ai + 1 }).select('id').single()).data!;
    for (const [gi, [goalTitle, kpis]] of goals.entries()) {
      const g = (await users.ed.from('exec_goals').insert({ plan_id: ep.id, axis_id: ax.id, title: goalTitle, sort_order: gi + 1 }).select('id').single()).data!;
      for (const [name, unit, type, target] of kpis) {
        await users.ed.from('kpis').insert({ plan_id: ep.id, goal_id: g.id, name, unit: unit === '%' ? null : unit, kpi_type: type, annual_target: target, direction: name.includes('زمن') ? 'decrease' : 'increase', baseline: name.includes('زمن') ? 9 : null, sort_order: sort++ });
      }
    }
  }
  await users.ed.from('exec_plans').update({ status: 'approved', approved_by: ids.ed, approved_at: new Date().toISOString() }).eq('id', ep.id);
  const { data: kp } = await users.ed.from('kpis').select('id,name').eq('plan_id', ep.id);
  const actuals = Object.fromEntries(axes.flatMap(([, gs]) => gs.flatMap(([, ks]) => ks.map(([n, , , , a]) => [n, a]))));
  for (const k of kp ?? []) await users.ed.from('kpi_measurements').insert({ kpi_id: k.id, value: actuals[k.name], measured_on: '2026-10-10', quarter: 4, recorded_by: ids.ed, note: '[تجريبي]' });

  console.log(`✓ بيانات تجريبية: ${Object.keys(ids).length} حسابات، ${Object.keys(planIds).length} خطط، ${n} تحديثات`);
  console.log(`  كلمة المرور الموحدة: ${PASSWORD}`);
  console.log('  الحسابات: ' + Object.keys(ids).map((k) => `${k}@demo.rawasim.local`).join('، '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
