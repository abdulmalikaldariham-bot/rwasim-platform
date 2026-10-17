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
      await sb.rpc('update_step_progress', { p_step: s.id, p_status: 'completed', p_note: '[تجريبي] أنجزت', p_output_achieved: '[تجريبي] تحقق المخرج' });
      n++;
    } else if (weeks.includes(3)) {
      await sb.rpc('update_step_progress', { p_step: s.id, p_status: 'in_progress', p_note: '[تجريبي] قيد العمل' });
      n++;
    }
  }
  // تفويض موظف
  const { data: commSteps } = await admin.from('steps').select('id').eq('plan_id', planIds.COMM).ilike('responsible_text', '%رشيد%').limit(8);
  for (const s of commSteps ?? []) await admin.from('steps').update({ assignee_id: ids.rashid }).eq('id', s.id);

  await users.ed.from('directives').insert({
    title: '[تجريبي] مراجعة جدول المشتريات الدورية قبل نهاية أكتوبر',
    target_type: 'department',
    department_id: d.SUPP,
    assignee_id: ids.supp,
    due_date: '2026-10-29',
    created_by: ids.ed,
  });
  await users.proj.from('escalations').insert({ kind: 'decision', department_id: d.PROJ, title: '[تجريبي] اعتماد موازنة رحلة بادية رواسم', raised_by: ids.proj });

  // خطة تنفيذية تجريبية صغيرة (محوران، 3 أهداف، 6 مؤشرات) لعرض المحور التنفيذي
  {
    const ed = users.ed;
    const { data: plan, error } = await ed.from('exec_plans').insert({ year: 2026, title: '[تجريبي] الخطة التنفيذية 2026م', created_by: ids.ed }).select('id').single();
    if (error) throw error;
    const axes = [
      { title: 'الأثر المجتمعي', goals: [
        { title: 'توسيع نطاق المستفيدين من البرامج', kpis: [
          { name: 'عدد المستفيدين من البرامج', unit: 'مستفيد', target: 1200, baseline: 0, actual: 870, dept: 'PROJ' },
          { name: 'نسبة رضا المستفيدين', unit: null, type: 'percentage', target: 85, actual: 88, dept: 'PROJ' },
        ] },
        { title: 'تعزيز الحضور الإعلامي للجمعية', kpis: [
          { name: 'عدد المواد الإعلامية المنشورة', unit: 'مادة', target: 60, baseline: 0, actual: 31, dept: 'COMM' },
          { name: 'نمو المتابعين في المنصات', unit: 'متابع', target: 5000, baseline: 0, actual: null, dept: 'COMM' },
        ] },
      ] },
      { title: 'الاستدامة المؤسسية', goals: [
        { title: 'رفع كفاءة التشغيل', kpis: [
          { name: 'نسبة الالتزام بالخطة التشغيلية', unit: null, type: 'percentage', target: 90, actual: 64, dept: 'EXEC' },
          { name: 'متوسط مدة إغلاق طلبات الشراء', unit: 'يوم', target: 7, baseline: 15, actual: 9, dept: 'SUPP', decrease: true },
        ] },
      ] },
    ];
    const measures: { kpi_id: string; value: number }[] = [];
    let ax = 0;
    for (const a of axes) {
      const { data: axis } = await ed.from('exec_axes').insert({ plan_id: plan.id, title: a.title, sort_order: ++ax }).select('id').single();
      let gi = 0;
      for (const g of a.goals) {
        const { data: goal } = await ed.from('exec_goals').insert({ plan_id: plan.id, axis_id: axis!.id, title: g.title, sort_order: ++gi }).select('id').single();
        let ki = 0;
        for (const k of g.kpis as { name: string; unit: string | null; type?: string; target: number; baseline?: number; actual: number | null; dept: string; decrease?: boolean }[]) {
          const { data: kpi, error: ke } = await ed
            .from('kpis')
            .insert({
              plan_id: plan.id,
              goal_id: goal!.id,
              name: k.name,
              unit: k.unit,
              kpi_type: k.type ?? 'numeric',
              direction: k.decrease ? 'decrease' : 'increase',
              baseline: k.baseline ?? null,
              annual_target: k.target,
              department_id: d[k.dept],
              sort_order: ax * 100 + gi * 10 + ++ki,
            })
            .select('id')
            .single();
          if (ke) throw ke;
          if (k.actual !== null) measures.push({ kpi_id: kpi!.id, value: k.actual });
        }
      }
    }
    await ed.from('exec_plans').update({ status: 'approved', approved_by: ids.ed, approved_at: new Date().toISOString() }).eq('id', plan.id);
    // القياسات تُسجل بعد الاعتماد (سياسة الجدول)
    const { error: me } = await ed.from('kpi_measurements').insert(measures.map((m) => ({ ...m, quarter: 3, measured_on: '2026-09-30', note: '[تجريبي]', recorded_by: ids.ed })));
    if (me) throw me;
  }

  console.log(`✓ بيانات تجريبية: ${Object.keys(ids).length} حسابات، ${Object.keys(planIds).length} خطط، ${n} تحديثات`);
  console.log(`  كلمة المرور الموحدة: ${PASSWORD}`);
  console.log('  الحسابات: ' + Object.keys(ids).map((k) => `${k}@demo.rawasim.local`).join('، '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
