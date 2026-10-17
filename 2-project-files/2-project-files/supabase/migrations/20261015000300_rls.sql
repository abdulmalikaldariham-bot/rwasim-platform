-- =====================================================================
-- سياسات أمان الصفوف (RLS) — الصلاحيات تُنفذ داخل قاعدة البيانات
-- =====================================================================

-- تفعيل RLS على كل الجداول
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- لا وصول للمستخدم غير المسجل إطلاقًا
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- دالة مساعدة: خطة الخطوة
create or replace function public.step_plan(p_step uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select plan_id from public.steps where id = p_step
$$;
grant execute on function public.step_plan(uuid) to authenticated;

-- ---------- الإدارات ----------
create policy departments_select on public.departments for select to authenticated using (public.is_active_user());
create policy departments_insert on public.departments for insert to authenticated with check (public.is_ed());
create policy departments_update on public.departments for update to authenticated using (public.is_ed()) with check (public.is_ed());

-- ---------- المستخدمون ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_ed() or public.is_sysadmin())
  with check (id = auth.uid() or public.is_ed() or public.is_sysadmin());

-- ---------- السنوات والأسابيع والأوزان ----------
create policy years_select on public.years for select to authenticated using (public.is_active_user());
create policy years_update on public.years for update to authenticated using (public.is_ed()) with check (public.is_ed());

create policy qweeks_select on public.quarter_weeks for select to authenticated using (public.is_active_user());
create policy qweeks_update on public.quarter_weeks for update to authenticated
  using (public.is_ed() and (select status from public.years y where y.year = quarter_weeks.year) <> 'archived')
  with check (public.is_ed());

create policy dws_select on public.dept_weight_sets for select to authenticated using (public.is_active_user());
create policy dwi_select on public.dept_weight_items for select to authenticated using (public.is_active_user());

-- ---------- الخطة التنفيذية ----------
create or replace function public.can_view_exec_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exec_plans p where p.id = p_plan and
    (public.is_ed() or (p.status in ('approved','archived') and public.is_active_user())))
$$;
create or replace function public.can_edit_exec_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ed() and exists (select 1 from public.exec_plans p join public.years y on y.year = p.year
                                     where p.id = p_plan and p.status <> 'archived' and y.status <> 'archived')
$$;
grant execute on function public.can_view_exec_plan(uuid), public.can_edit_exec_plan(uuid) to authenticated;

create policy exec_plans_select on public.exec_plans for select to authenticated
  using (public.is_ed() or (status in ('approved','archived') and public.is_active_user()));
create policy exec_plans_insert on public.exec_plans for insert to authenticated with check (public.is_ed());
create policy exec_plans_update on public.exec_plans for update to authenticated using (public.can_edit_exec_plan(id)) with check (public.is_ed());
create policy exec_plans_delete on public.exec_plans for delete to authenticated using (public.is_ed() and status = 'draft');

create policy exec_axes_select on public.exec_axes for select to authenticated using (public.can_view_exec_plan(plan_id));
create policy exec_axes_write on public.exec_axes for all to authenticated using (public.can_edit_exec_plan(plan_id)) with check (public.can_edit_exec_plan(plan_id));
create policy exec_goals_select on public.exec_goals for select to authenticated using (public.can_view_exec_plan(plan_id));
create policy exec_goals_write on public.exec_goals for all to authenticated using (public.can_edit_exec_plan(plan_id)) with check (public.can_edit_exec_plan(plan_id));
create policy kpis_select on public.kpis for select to authenticated using (public.can_view_exec_plan(plan_id));
create policy kpis_write on public.kpis for all to authenticated using (public.can_edit_exec_plan(plan_id)) with check (public.can_edit_exec_plan(plan_id));

create policy kpi_targets_select on public.kpi_period_targets for select to authenticated
  using (exists (select 1 from public.kpis k where k.id = kpi_id and public.can_view_exec_plan(k.plan_id)));
create policy kpi_targets_write on public.kpi_period_targets for all to authenticated
  using (exists (select 1 from public.kpis k where k.id = kpi_id and public.can_edit_exec_plan(k.plan_id)))
  with check (exists (select 1 from public.kpis k where k.id = kpi_id and public.can_edit_exec_plan(k.plan_id)));

create policy kpi_meas_select on public.kpi_measurements for select to authenticated
  using (exists (select 1 from public.kpis k where k.id = kpi_id and public.can_view_exec_plan(k.plan_id)));
create policy kpi_meas_insert on public.kpi_measurements for insert to authenticated
  with check (recorded_by = auth.uid() and exists (
    select 1 from public.kpis k join public.exec_plans p on p.id = k.plan_id
     where k.id = kpi_id and p.status = 'approved'
       and (public.is_ed() or public.is_manager_of(k.department_id))));
create policy kpi_meas_update on public.kpi_measurements for update to authenticated
  using (public.is_ed() or (recorded_by = auth.uid() and public.my_role() = 'dept_manager'))
  with check (public.is_ed() or (recorded_by = auth.uid() and public.my_role() = 'dept_manager'));
create policy kpi_meas_delete on public.kpi_measurements for delete to authenticated
  using (public.is_ed() or (recorded_by = auth.uid() and public.my_role() = 'dept_manager'));

-- ---------- الخطط التشغيلية ----------
-- تقييم على أعمدة الصف مباشرة (لا استعلام فرعي على الجدول نفسه) ليعمل INSERT ... RETURNING
create or replace function public.can_view_plan_row(p_id uuid, p_dept uuid, p_status public.plan_status) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ed()
      or (public.is_board() and p_status in ('approved','archived'))
      or public.is_manager_of(p_dept)
      or (public.my_role() = 'employee' and p_status in ('approved','archived')
          and exists (select 1 from public.steps s where s.plan_id = p_id and s.assignee_id = auth.uid()))
$$;
grant execute on function public.can_view_plan_row(uuid, uuid, public.plan_status) to authenticated;
create policy op_plans_select on public.op_plans for select to authenticated using (public.can_view_plan_row(id, department_id, status));
create policy op_plans_insert on public.op_plans for insert to authenticated
  with check ((public.is_ed() or public.is_manager_of(department_id))
              and (select status from public.years y where y.year = op_plans.year) <> 'archived');
create policy op_plans_update on public.op_plans for update to authenticated
  using (public.can_edit_plan(id)) with check (public.is_ed() or public.is_manager_of(department_id));
create policy op_plans_delete on public.op_plans for delete to authenticated
  using (public.can_edit_plan(id) and status = 'draft');

create policy activities_select on public.activities for select to authenticated using (
  public.can_view_plan(plan_id)
  and (public.my_role() <> 'employee'
       or exists (select 1 from public.steps s where s.activity_id = activities.id and s.assignee_id = auth.uid())));
create policy activities_insert on public.activities for insert to authenticated with check (public.can_edit_plan(plan_id));
create policy activities_update on public.activities for update to authenticated
  using (public.can_manage_plan(plan_id)) with check (public.can_manage_plan(plan_id));
create policy activities_delete on public.activities for delete to authenticated using (public.can_edit_plan(plan_id));

create policy steps_select on public.steps for select to authenticated using (
  public.can_view_plan(plan_id) and (public.my_role() <> 'employee' or assignee_id = auth.uid()));
create policy steps_insert on public.steps for insert to authenticated with check (public.can_edit_plan(plan_id));
create policy steps_update on public.steps for update to authenticated
  using (public.can_manage_plan(plan_id)) with check (public.can_manage_plan(plan_id));
create policy steps_delete on public.steps for delete to authenticated using (public.can_edit_plan(plan_id));

create policy step_weeks_select on public.step_weeks for select to authenticated using (public.can_view_step(step_id));
create policy step_weeks_write on public.step_weeks for all to authenticated
  using (public.can_edit_plan(public.step_plan(step_id))) with check (public.can_edit_plan(public.step_plan(step_id)));

create policy substeps_select on public.substeps for select to authenticated using (public.can_view_step(step_id));
create policy substeps_write on public.substeps for all to authenticated
  using (public.can_edit_plan(public.step_plan(step_id))) with check (public.can_edit_plan(public.step_plan(step_id)));

create policy step_updates_select on public.step_updates for select to authenticated using (public.can_view_step(step_id));

create policy evidence_select on public.evidence for select to authenticated using (public.can_view_step(step_id));
create policy evidence_insert on public.evidence for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_update_step(step_id) and plan_id = public.step_plan(step_id));
create policy evidence_delete on public.evidence for delete to authenticated
  using (public.is_ed() or (uploaded_by = auth.uid() and public.can_update_step(step_id)));

create policy snapshots_select on public.plan_weight_snapshots for select to authenticated
  using (public.can_view_plan(plan_id) and public.my_role() <> 'employee');

create policy change_requests_select on public.change_requests for select to authenticated
  using (public.is_ed() or public.can_manage_plan(plan_id));

-- ---------- الاستيراد ----------
create policy imports_select on public.plan_imports for select to authenticated using (public.is_ed() or created_by = auth.uid());
create policy imports_insert on public.plan_imports for insert to authenticated
  with check (created_by = auth.uid() and (public.is_ed() or public.my_role() = 'dept_manager'));
create policy imports_update on public.plan_imports for update to authenticated
  using (public.is_ed() or created_by = auth.uid()) with check (public.is_ed() or created_by = auth.uid());

-- ---------- مركز المتابعة التنفيذية ----------
create policy directives_select on public.directives for select to authenticated
  using (public.is_ed() or assignee_id = auth.uid() or (department_id is not null and public.is_manager_of(department_id)));
create policy directives_insert on public.directives for insert to authenticated with check (public.is_ed() and created_by = auth.uid());
create policy directives_update on public.directives for update to authenticated using (public.is_ed()) with check (public.is_ed());
create policy directives_delete on public.directives for delete to authenticated using (public.is_ed());

create policy directive_updates_select on public.directive_updates for select to authenticated
  using (exists (select 1 from public.directives d where d.id = directive_id));

create policy escalations_select on public.escalations for select to authenticated
  using (public.is_ed() or raised_by = auth.uid() or (department_id is not null and public.is_manager_of(department_id)));
create policy escalations_insert on public.escalations for insert to authenticated
  with check (raised_by = auth.uid() and (
    public.is_ed()
    or (department_id is not null and public.is_manager_of(department_id))
    or (step_id is not null and public.can_update_step(step_id))));
create policy escalations_update on public.escalations for update to authenticated using (public.is_ed()) with check (public.is_ed());

-- ---------- التقارير ----------
create policy reports_select on public.reports for select to authenticated using (
  public.is_ed()
  or generated_by = auth.uid()
  or (status = 'approved' and (
        public.is_board()
        or (public.my_role() = 'dept_manager' and (department_id is null or department_id = public.my_dept())))));
create policy reports_insert on public.reports for insert to authenticated with check (
  public.is_ed() or (public.my_role() = 'dept_manager' and department_id = public.my_dept()));
create policy reports_update on public.reports for update to authenticated using (public.is_ed()) with check (public.is_ed());
create policy reports_delete on public.reports for delete to authenticated using (public.is_ed() or generated_by = auth.uid());

-- ---------- السجل والإعدادات ----------
create policy audit_select on public.audit_log for select to authenticated using (public.is_ed() or public.is_sysadmin());

create policy settings_select on public.settings for select to authenticated using (public.is_active_user());
create policy settings_write on public.settings for all to authenticated
  using (public.is_ed() or public.is_sysadmin()) with check (public.is_ed() or public.is_sysadmin());

-- الجداول التي تُكتب عبر الدوال فقط: إلغاء صلاحيات الكتابة المباشرة احتياطًا
revoke insert, update, delete on public.step_updates, public.audit_log, public.plan_weight_snapshots,
  public.change_requests, public.dept_weight_sets, public.dept_weight_items, public.directive_updates from authenticated;
revoke insert, delete on public.years, public.quarter_weeks from authenticated;
revoke delete on public.profiles from authenticated;
revoke insert on public.profiles from authenticated;

-- دوال داخلية لا تُستدعى من العميل
revoke execute on function public._insert_step_json(uuid, uuid, jsonb) from authenticated;
revoke execute on function public.default_quarter_weeks(int) from authenticated;
revoke execute on function public.plan_snapshot(uuid) from authenticated;
