-- =====================================================================
-- روابط عرض الأداء: خيار «السنة كاملة» (إنجاز الأرباع حتى الربع الحالي)
-- ترحيل إضافي آمن: عمود جديد افتراضيه false، ويعاد إنشاء share_dashboard
-- لإرجاع الإعداد الجديد فقط. يمكن تشغيله أكثر من مرة.
-- =====================================================================
alter table public.share_links add column if not exists show_year boolean not null default false;

create or replace function public.share_dashboard(p_token text, p_code text default null, p_year int default null, p_quarter int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l record; chk jsonb; v_year int; v_quarter int; v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_weights jsonb; v_facts jsonb; v_weeks jsonb; v_depts jsonb; v_exec jsonb := null; v_years jsonb; v_plan uuid;
begin
  chk := public.share_check(p_token, p_code);
  if not (chk->>'ok')::boolean then return chk; end if;
  select * into l from public.share_links where token = p_token;

  if l.allow_period_switch and p_year is not null then
    v_year := p_year; v_quarter := coalesce(p_quarter, 4);
  elsif l.follow_current or l.year is null then
    v_year := extract(year from v_today)::int; v_quarter := extract(quarter from v_today)::int;
    if not exists (select 1 from public.years where year = v_year) then
      select max(year) into v_year from public.years; v_quarter := 4;
    end if;
  else
    v_year := l.year; v_quarter := coalesce(l.quarter, 4);
  end if;

  update public.share_links set last_viewed_at = now(), view_count = view_count + 1 where id = l.id;

  select coalesce(jsonb_agg(year order by year), '[]') into v_years from public.years where status <> 'planning' or year = v_year;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'short', coalesce(d.short_name, d.name), 'sort', d.sort_order) order by d.sort_order), '[]')
    into v_depts from public.departments d where d.is_active or exists (select 1 from public.op_plans p where p.department_id = d.id and p.year = v_year);

  with s as (select id from public.dept_weight_sets where year = v_year and status = 'approved' order by version desc limit 1)
  select coalesce(jsonb_agg(jsonb_build_object('department_id', i.department_id, 'weight', i.weight)), '[]') into v_weights
    from s join public.dept_weight_items i on i.set_id = s.id;

  select coalesce(jsonb_agg(jsonb_build_object('quarter', quarter, 'week_index', week_index, 'month', month, 'week_of_month', week_of_month,
                                                'start_date', start_date, 'end_date', end_date) order by quarter, week_index), '[]')
    into v_weeks from public.quarter_weeks where year = v_year;

  if l.show_operational then
    -- خطط معتمدة أو مؤرشفة فقط؛ بلا أسماء أشخاص أو مخرجات أو ملاحظات
    select coalesce(jsonb_agg(jsonb_build_object(
             'plan_id', op.id, 'department_id', op.department_id, 'quarter', op.quarter, 'status', op.status,
             'activity_id', a.id, 'activity_weight', a.weight, 'activity_kind', a.kind,
             'activity_title', case when l.show_activities then a.title end,
             'step_id', s.id, 'step_weight', s.weight, 'step_progress', s.progress, 'step_status', s.status,
             'weeks', coalesce((select jsonb_agg(w.week_index order by w.week_index) from public.step_weeks w where w.step_id = s.id), '[]'),
             'start_date', s.start_date, 'end_date', s.end_date, 'dates_source', s.dates_source,
             'last_update_at', s.last_update_at, 'actual_end', s.actual_end)), '[]')
      into v_facts
      from public.op_plans op
      join public.activities a on a.plan_id = op.id and not a.is_archived
      left join public.steps s on s.activity_id = a.id and not s.is_archived
     where op.year = v_year and op.status in ('approved','archived');
  else
    v_facts := '[]';
  end if;

  if l.show_executive then
    select id into v_plan from public.exec_plans where year = v_year and status in ('approved','archived');
    if v_plan is not null then
      select jsonb_build_object(
        'axes', coalesce((select jsonb_agg(jsonb_build_object('id', ax.id, 'title', ax.title) order by ax.sort_order) from public.exec_axes ax where ax.plan_id = v_plan), '[]'),
        'goals', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'axis_id', g.axis_id, 'title', g.title) order by g.sort_order) from public.exec_goals g where g.plan_id = v_plan), '[]'),
        'kpis', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', k.id, 'goal_id', k.goal_id, 'name', k.name, 'unit', k.unit, 'kpi_type', k.kpi_type, 'direction', k.direction,
                    'baseline', k.baseline, 'annual_target', k.annual_target, 'department_id', k.department_id, 'sort', k.sort_order,
                    'targets', coalesce((select jsonb_object_agg(t.quarter, t.target) from public.kpi_period_targets t where t.kpi_id = k.id), '{}'),
                    'actual', case when k.actual_mode = 'derived_count' then public.kpi_derived_value(k.id)
                                   else (select m.value from public.kpi_measurements m where m.kpi_id = k.id order by m.measured_on desc, m.recorded_at desc limit 1) end
                  ) order by k.sort_order)
                  from public.kpis k where k.plan_id = v_plan and (l.kpi_ids is null or k.id = any(l.kpi_ids))), '[]'))
      into v_exec;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'name', l.name, 'year', v_year, 'quarter', v_quarter, 'years', v_years, 'today', v_today,
    'settings', jsonb_build_object('allow_period_switch', l.allow_period_switch, 'show_operational', l.show_operational,
                                   'show_executive', l.show_executive, 'show_activities', l.show_activities,
                                   'kpi_limit', l.kpi_limit, 'refresh_seconds', l.refresh_seconds, 'show_year', l.show_year),
    'departments', v_depts, 'weights', v_weights, 'weeks', v_weeks, 'facts', v_facts, 'exec', v_exec,
    'generated_at', now());
end $$;

revoke execute on function public.share_dashboard(text, text, int, int) from public;
grant execute on function public.share_dashboard(text, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
