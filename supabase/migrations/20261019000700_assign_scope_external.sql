-- =====================================================================
-- إسناد المهام: نطاق «جميع موظفي الجمعية» إلى جانب «جميع موظفي الإدارة»،
-- وإضافة مكلفين من خارج المنصة بالاسم فقط (دون حساب).
-- ترحيل إضافي آمن: أعمدة جديدة بقيم افتراضية، ويحافظ على p_all للتوافق.
-- يمكن تشغيله أكثر من مرة.
-- =====================================================================

alter table public.steps add column if not exists assign_scope text not null default 'none';
alter table public.steps add column if not exists external_assignees text[] not null default '{}';

do $$ begin
  alter table public.steps add constraint steps_assign_scope_chk check (assign_scope in ('none','department','org'));
exception when duplicate_object then null; end $$;

comment on column public.steps.assign_scope is 'none = اختيار يدوي، department = جميع موظفي الإدارة، org = جميع موظفي الجمعية';
comment on column public.steps.external_assignees is 'أسماء مكلفين من خارج المنصة (بلا حساب)؛ للعرض فقط ولا تدخل في احتساب المهمة الفردية';

update public.steps set assign_scope = 'department' where assign_all and assign_scope = 'none';

drop function if exists public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean);
create or replace function public.set_step_assignees(
  p_step uuid,
  p_users uuid[],
  p_lead uuid default null,
  p_mode text default null,
  p_threshold numeric default null,
  p_all boolean default false,
  p_scope text default null,
  p_external text[] default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  s record; v_dept uuid; v_users uuid[]; v_bad int; v_count int; v_scope text; v_external text[];
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

  if v_scope = 'department' then
    select array_agg(id) into v_users from public.profiles
     where is_active and department_id = v_dept and role in ('employee','dept_manager');
  elsif v_scope = 'org' then
    select array_agg(id) into v_users from public.profiles
     where is_active and role in ('employee','dept_manager');
  else
    v_users := coalesce(p_users, '{}');
  end if;
  v_users := array(select distinct unnest(coalesce(v_users, '{}')));

  -- الأسماء الخارجية: بلا فراغات زائدة، غير مكررة، بحد معقول
  v_external := array(
    select n from (select distinct on (n) n, ord from (
      select btrim(regexp_replace(x, '\s+', ' ', 'g')) as n, ord
        from unnest(coalesce(p_external, s.external_assignees, '{}')) with ordinality as t(x, ord)) a
      where n <> '' order by n, ord) b
    order by ord);
  if coalesce(array_length(v_external, 1), 0) > 50 then raise exception 'الحد الأقصى 50 اسمًا من خارج المنصة'; end if;
  if exists (select 1 from unnest(v_external) n where char_length(n) > 120) then raise exception 'الاسم طويل جدًا'; end if;

  -- كل المكلفين حسابات نشطة، ومن الإدارة نفسها إذا كان المُسند مدير الإدارة
  select count(*) into v_bad from unnest(v_users) u
   where not exists (select 1 from public.profiles p where p.id = u and p.is_active
                       and (public.is_ed() or p.department_id = v_dept));
  if v_bad > 0 then raise exception 'يمكن إسناد المهمة لحسابات نشطة من الإدارة نفسها فقط'; end if;
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
    assign_scope = v_scope,
    external_assignees = v_external
   where id = p_step;
  perform set_config('app.assign_rpc', 'off', true);

  select count(*) into v_count from public.step_assignees where step_id = p_step;
  if coalesce(p_mode, s.assignment_mode) = 'individual' and s.plan_status = 'approved' then
    perform public.recompute_individual_step(p_step, null);
  end if;
  return v_count + coalesce(array_length(v_external, 1), 0);
end $$;

drop trigger if exists audit_steps on public.steps;
create trigger audit_steps after insert or delete or update of weight, title, is_core, is_archived, assignee_id, responsible_text,
  start_date, end_date, output_policy, assignment_mode, completion_threshold, assign_scope, external_assignees on public.steps
  for each row execute function public.audit_trigger();

grant execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean, text, text[]) to authenticated;
revoke execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean, text, text[]) from public, anon;
