-- =====================================================================
-- إسناد المهام: نطاق «جميع موظفي الجمعية» إلى جانب «جميع موظفي الإدارة»،
-- والإسناد للجميع يبقى متزامنًا: من يُضاف لاحقًا إلى الإدارة أو الجمعية
-- تظهر له المهمة في «مهامي» تلقائيًا.
-- ترحيل إضافي آمن: يحافظ على p_all للتوافق، ويمكن تشغيله أكثر من مرة.
-- =====================================================================

alter table public.steps add column if not exists assign_scope text not null default 'none';

do $$ begin
  alter table public.steps add constraint steps_assign_scope_chk check (assign_scope in ('none','department','org'));
exception when duplicate_object then null; end $$;

comment on column public.steps.assign_scope is 'none = اختيار يدوي، department = جميع موظفي الإدارة، org = جميع موظفي الجمعية';

update public.steps set assign_scope = 'department' where assign_all and assign_scope = 'none';

-- من يشملهم «الجميع»: كل حساب نشط عدا أعضاء المجلس، من الإدارة نفسها أو من الجمعية كلها
create or replace function public.assign_pool(p_scope text, p_dept uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where is_active and role <> 'board_member'
     and (p_scope = 'org' or (p_scope = 'department' and department_id = p_dept))
$$;
revoke execute on function public.assign_pool(text, uuid) from public, anon, authenticated;

-- إزالة دالة الإسناد بالأسماء الخارجية إن كانت نسخة سابقة من هذا الترحيل قد طُبقت
drop function if exists public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean, text, text[]);
drop function if exists public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean);
create or replace function public.set_step_assignees(
  p_step uuid,
  p_users uuid[],
  p_lead uuid default null,
  p_mode text default null,
  p_threshold numeric default null,
  p_all boolean default false,
  p_scope text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  s record; v_dept uuid; v_users uuid[]; v_bad int; v_count int; v_scope text;
begin
  select st.*, op.department_id as dept, op.status as plan_status into s
    from public.steps st join public.op_plans op on op.id = st.plan_id where st.id = p_step;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if not public.can_manage_plan(s.plan_id) or s.plan_status = 'archived' then
    raise exception 'إسناد المهام من صلاحية مدير الإدارة والمدير التنفيذي' using errcode = '42501';
  end if;
  v_dept := s.dept;
  v_scope := coalesce(p_scope, case when p_all then 'department' else 'none' end);
  if v_scope not in ('none','department','org') then raise exception 'نطاق الإسناد غير صحيح'; end if;
  if v_scope = 'org' and not public.is_ed() then
    raise exception 'الإسناد لجميع موظفي الجمعية من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;

  if v_scope = 'none' then
    v_users := coalesce(p_users, '{}');
  else
    v_users := array(select public.assign_pool(v_scope, v_dept));
  end if;
  v_users := array(select distinct unnest(v_users));

  -- الاختيار اليدوي: حسابات نشطة، ومن الإدارة نفسها إذا كان المُسند مدير الإدارة
  if v_scope = 'none' then
    select count(*) into v_bad from unnest(v_users) u
     where not exists (select 1 from public.profiles p where p.id = u and p.is_active
                         and (public.is_ed() or p.department_id = v_dept));
    if v_bad > 0 then raise exception 'يمكن إسناد المهمة لحسابات نشطة من الإدارة نفسها فقط'; end if;
  end if;
  if p_lead is not null and not (p_lead = any(v_users)) then raise exception 'المسؤول الرئيسي يجب أن يكون من المكلفين'; end if;
  if p_mode is not null and p_mode <> s.assignment_mode and (s.progress > 0 or s.status <> 'not_started') then
    raise exception 'لا يمكن تغيير نوع الإسناد بعد بدء إنجاز المهمة';
  end if;

  perform set_config('app.assign_rpc', 'on', true);
  delete from public.step_assignees where step_id = p_step and not (user_id = any(v_users));
  insert into public.step_assignees(step_id, user_id, is_lead, assigned_by)
  select p_step, u, coalesce(u = p_lead, false), auth.uid() from unnest(v_users) u
  on conflict (step_id, user_id) do update set is_lead = excluded.is_lead;
  update public.steps set
    assignee_id = coalesce(p_lead, case when array_length(v_users, 1) = 1 then v_users[1] end),
    assignment_mode = coalesce(p_mode, assignment_mode),
    completion_threshold = coalesce(p_threshold, completion_threshold),
    assign_all = v_scope <> 'none',
    assign_scope = v_scope
   where id = p_step;
  perform set_config('app.assign_rpc', 'off', true);

  select count(*) into v_count from public.step_assignees where step_id = p_step;
  if coalesce(p_mode, s.assignment_mode) = 'individual' and s.plan_status = 'approved' then
    perform public.recompute_individual_step(p_step, null);
  end if;
  return v_count;
end $$;

-- مزامنة مهام «الجميع» لحساب واحد: يُضاف إن أصبح ضمن النطاق، ويُزال (ما لم يكن أنجز) إن خرج منه
create or replace function public.sync_scoped_assignments(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select st.id, st.assignment_mode, op.status as plan_status,
           p_user in (select public.assign_pool(st.assign_scope, op.department_id)) as eligible,
           exists (select 1 from public.step_assignees a where a.step_id = st.id and a.user_id = p_user) as assigned
      from public.steps st
      join public.op_plans op on op.id = st.plan_id
      join public.years y on y.year = op.year
     where st.assign_scope in ('department','org') and not st.is_archived
       and op.status <> 'archived' and y.status <> 'archived'
  loop
    if r.eligible and not r.assigned then
      insert into public.step_assignees(step_id, user_id, is_lead) values (r.id, p_user, false) on conflict do nothing;
    elsif not r.eligible and r.assigned then
      delete from public.step_assignees where step_id = r.id and user_id = p_user and status <> 'completed';
    else
      continue;
    end if;
    if r.assignment_mode = 'individual' and r.plan_status = 'approved' then
      perform public.recompute_individual_step(r.id, null);
    end if;
  end loop;
end $$;
revoke execute on function public.sync_scoped_assignments(uuid) from public, anon, authenticated;

create or replace function public.trg_profile_scoped_assignments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_scoped_assignments(new.id);
  return null;
end $$;
drop trigger if exists trg_profile_scoped_assignments on public.profiles;
create trigger trg_profile_scoped_assignments after insert or update of is_active, department_id, role on public.profiles
  for each row execute function public.trg_profile_scoped_assignments();

drop trigger if exists audit_steps on public.steps;
create trigger audit_steps after insert or delete or update of weight, title, is_core, is_archived, assignee_id, responsible_text,
  start_date, end_date, output_policy, assignment_mode, completion_threshold, assign_scope on public.steps
  for each row execute function public.audit_trigger();

-- إزالة عمود الأسماء الخارجية إن كانت نسخة سابقة من هذا الترحيل قد أضافته
alter table public.steps drop column if exists external_assignees;

-- مزامنة المهام المسندة للجميع سابقًا مع الحسابات الحالية (من أُضيف بعد الإسناد يحصل عليها الآن)
select public.sync_scoped_assignments(id) from public.profiles;

grant execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean, text) to authenticated;
revoke execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean, text) from public, anon;
