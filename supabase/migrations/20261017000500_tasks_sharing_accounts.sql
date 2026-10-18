-- =====================================================================
-- الإصدار الثاني: تواريخ المهام، المخرجات، الإسناد المتعدد،
-- روابط عرض الأداء، وتحسين الحسابات.
-- ترحيل إضافي آمن: لا يحذف أي جدول أو عمود أو بيانات قائمة،
-- ويحافظ على توافق الإصدار السابق من الموقع.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) المهام: التواريخ والمخرجات ونوع الإسناد
-- ---------------------------------------------------------------------
alter table public.steps add column if not exists start_date date;
alter table public.steps add column if not exists end_date date;
alter table public.steps add column if not exists dates_source text not null default 'weeks';
alter table public.steps add column if not exists output_achieved text;
alter table public.steps add column if not exists output_policy text not null default 'description';
alter table public.steps add column if not exists assignment_mode text not null default 'shared';
alter table public.steps add column if not exists completion_threshold numeric(5,2) not null default 100;
alter table public.steps add column if not exists assign_all boolean not null default false;

do $$ begin
  alter table public.steps add constraint steps_dates_source_chk check (dates_source in ('weeks','manual','none'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.steps add constraint steps_output_policy_chk check (output_policy in ('none','description','evidence'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.steps add constraint steps_assignment_mode_chk check (assignment_mode in ('shared','individual'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.steps add constraint steps_threshold_chk check (completion_threshold > 0 and completion_threshold <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.steps add constraint steps_dates_order_chk check (start_date is null or end_date is null or end_date >= start_date);
exception when duplicate_object then null; end $$;

comment on column public.steps.dates_source is 'weeks = مشتقة من الجدولة الأسبوعية (تقديرية)، manual = مدخلة يدويًا، none = بلا تاريخ (للمراجعة)';
comment on column public.steps.output_policy is 'none = لا يلزم توثيق، description = يلزم وصف المخرج المتحقق عند الإكمال، evidence = وصف + شاهد/رابط';

-- اشتقاق تواريخ المهمة من أسابيعها المجدولة (لا يُخترع تاريخ دون جدولة)
create or replace function public.derive_step_dates(p_step uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_s date; v_e date;
begin
  select min(qw.start_date), max(qw.end_date) into v_s, v_e
    from public.step_weeks sw
    join public.steps st on st.id = sw.step_id
    join public.op_plans op on op.id = st.plan_id
    join public.quarter_weeks qw on qw.year = op.year and qw.quarter = op.quarter and qw.week_index = sw.week_index
   where sw.step_id = p_step;
  update public.steps
     set start_date = v_s, end_date = v_e, dates_source = case when v_s is null then 'none' else 'weeks' end
   where id = p_step and dates_source <> 'manual';
end $$;

-- تعبئة السجلات القائمة
do $$ declare r record; begin
  for r in select id from public.steps where start_date is null and dates_source <> 'manual' loop
    perform public.derive_step_dates(r.id);
  end loop;
end $$;

create or replace function public.trg_step_weeks_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.derive_step_dates(coalesce(new.step_id, old.step_id));
  return null;
end $$;
drop trigger if exists trg_step_weeks_dates on public.step_weeks;
create trigger trg_step_weeks_dates after insert or update or delete on public.step_weeks
  for each row execute function public.trg_step_weeks_dates();

-- عند مراجعة حدود الأسابيع تُحدّث التواريخ المشتقة
create or replace function public.trg_quarter_weeks_dates() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct sw.step_id from public.step_weeks sw
             join public.steps st on st.id = sw.step_id
             join public.op_plans op on op.id = st.plan_id
            where op.year = new.year and op.quarter = new.quarter and sw.week_index = new.week_index loop
    perform public.derive_step_dates(r.step_id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_quarter_weeks_dates on public.quarter_weeks;
create trigger trg_quarter_weeks_dates after update of start_date, end_date on public.quarter_weeks
  for each row execute function public.trg_quarter_weeks_dates();

-- ---------------------------------------------------------------------
-- 2) الإسناد المتعدد
-- ---------------------------------------------------------------------
create table if not exists public.step_assignees (
  step_id uuid not null references public.steps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_lead boolean not null default false,
  status public.step_status not null default 'not_started',  -- للمهمة الفردية: إنجاز هذا الشخص
  done_at timestamptz,
  note text,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (step_id, user_id)
);
create index if not exists step_assignees_user_idx on public.step_assignees(user_id);
alter table public.step_assignees enable row level security;

-- نقل الإسنادات السابقة (مسؤول واحد) دون فقد
insert into public.step_assignees(step_id, user_id, is_lead, assigned_at)
select id, assignee_id, true, coalesce(updated_at, now()) from public.steps where assignee_id is not null
on conflict (step_id, user_id) do nothing;

create or replace function public.is_step_assignee(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.step_assignees a where a.step_id = p_step and a.user_id = auth.uid())
$$;

create or replace function public.has_assignment_in_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.step_assignees a join public.steps s on s.id = a.step_id
                  where s.plan_id = p_plan and a.user_id = auth.uid())
$$;

-- تحديث دوال الصلاحيات لتعتمد على جدول الإسناد
create or replace function public.can_view_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.op_plans op
    where op.id = p_plan and (
      public.is_ed()
      or (public.is_board() and op.status in ('approved','archived'))
      or public.is_manager_of(op.department_id)
      or (op.status in ('approved','archived') and public.has_assignment_in_plan(op.id))
    )
  )
$$;

create or replace function public.can_view_plan_row(p_id uuid, p_dept uuid, p_status public.plan_status) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ed()
      or (public.is_board() and p_status in ('approved','archived'))
      or public.is_manager_of(p_dept)
      or (p_status in ('approved','archived') and public.has_assignment_in_plan(p_id))
$$;

-- يرى المكلف مهامه فقط؛ ومدير الإدارة والمدير التنفيذي والمجلس يرون الخطة كاملة
create or replace function public.sees_whole_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.op_plans op where op.id = p_plan and (
    public.is_ed() or (public.is_board() and op.status in ('approved','archived')) or public.is_manager_of(op.department_id)))
$$;

create or replace function public.can_view_step(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.steps s
    where s.id = p_step and public.can_view_plan(s.plan_id)
      and (public.sees_whole_plan(s.plan_id) or public.is_step_assignee(s.id))
  )
$$;

create or replace function public.can_view_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.activities a
    where a.id = p_activity and public.can_view_plan(a.plan_id)
      and (public.sees_whole_plan(a.plan_id)
           or exists (select 1 from public.steps s join public.step_assignees x on x.step_id = s.id
                       where s.activity_id = a.id and x.user_id = auth.uid()))
  )
$$;

create or replace function public.can_update_step(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.steps s
    join public.op_plans op on op.id = s.plan_id
    join public.years y on y.year = op.year
    where s.id = p_step
      and not s.is_archived
      and op.status = 'approved'
      and y.status <> 'archived'
      and (public.is_ed() or public.is_manager_of(op.department_id) or public.is_step_assignee(s.id))
  )
$$;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (
  public.can_view_plan(plan_id)
  and (public.sees_whole_plan(plan_id)
       or exists (select 1 from public.steps s join public.step_assignees x on x.step_id = s.id
                   where s.activity_id = activities.id and x.user_id = auth.uid())));

drop policy if exists steps_select on public.steps;
create policy steps_select on public.steps for select to authenticated using (
  public.can_view_plan(plan_id) and (public.sees_whole_plan(plan_id) or public.is_step_assignee(id)));

drop policy if exists step_assignees_select on public.step_assignees;
create policy step_assignees_select on public.step_assignees for select to authenticated using (public.can_view_step(step_id));
revoke insert, update, delete on public.step_assignees from authenticated, anon;
grant select on public.step_assignees to authenticated;
grant all on public.step_assignees to service_role;

-- توافق مع الإصدار السابق: تغيير assignee_id مباشرة يجعل هذا الشخص هو المكلف الوحيد
create or replace function public.trg_sync_legacy_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is distinct from old.assignee_id and current_setting('app.assign_rpc', true) is distinct from 'on' then
    delete from public.step_assignees where step_id = new.id;
    if new.assignee_id is not null then
      insert into public.step_assignees(step_id, user_id, is_lead, assigned_by) values (new.id, new.assignee_id, true, auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_sync_legacy_assignee on public.steps;
create trigger trg_sync_legacy_assignee after update of assignee_id on public.steps
  for each row execute function public.trg_sync_legacy_assignee();

-- إعادة احتساب المهمة الفردية: كل مكلف يسجل إنجازه، وتكتمل المهمة وفق النسبة المحددة
create or replace function public.recompute_individual_step(p_step uuid, p_note text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s record; v_total int; v_done int; v_pct numeric; v_progress numeric; v_status public.step_status;
begin
  select * into s from public.steps where id = p_step for update;
  select count(*), count(*) filter (where status = 'completed') into v_total, v_done from public.step_assignees where step_id = p_step;
  if v_total = 0 then
    v_progress := 0; v_status := 'not_started';
  else
    v_pct := v_done * 100.0 / v_total;
    v_progress := least(100, round(v_pct / s.completion_threshold * 100, 2));
    v_status := case when v_pct >= s.completion_threshold then 'completed' when v_done > 0 then 'in_progress' else 'not_started' end;
    if v_status = 'completed' then v_progress := 100; end if;
  end if;
  if v_status = 'not_started' and s.status = 'on_hold' then v_status := 'on_hold'; end if;
  update public.steps set status = v_status, progress = v_progress,
    actual_start = case when v_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when v_status = 'completed' then coalesce(actual_end, current_date) else null end,
    last_update_at = now(), last_update_by = auth.uid()
   where id = p_step;
  if v_status is distinct from s.status or v_progress is distinct from s.progress or p_note is not null then
    insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
    values (p_step, s.plan_id, auth.uid(), s.status, v_status, s.progress, v_progress, p_note);
  end if;
  return v_progress;
end $$;
revoke execute on function public.recompute_individual_step(uuid, text) from public, anon, authenticated;

-- إسناد المهمة: مستخدم أو عدة مستخدمين أو جميع موظفي الإدارة
create or replace function public.set_step_assignees(
  p_step uuid,
  p_users uuid[],
  p_lead uuid default null,
  p_mode text default null,
  p_threshold numeric default null,
  p_all boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare
  s record; v_dept uuid; v_users uuid[]; v_bad int; v_count int;
begin
  select st.*, op.department_id as dept, op.status as plan_status into s
    from public.steps st join public.op_plans op on op.id = st.plan_id where st.id = p_step;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if not public.can_manage_plan(s.plan_id) or s.plan_status = 'archived' then
    raise exception 'إسناد المهام من صلاحية مدير الإدارة والمدير التنفيذي' using errcode = '42501';
  end if;
  v_dept := s.dept;
  if p_all then
    select array_agg(id) into v_users from public.profiles
     where is_active and department_id = v_dept and role in ('employee','dept_manager');
  else
    v_users := coalesce(p_users, '{}');
  end if;
  v_users := array(select distinct unnest(v_users));
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
    assign_all = coalesce(p_all, false)
   where id = p_step;
  perform set_config('app.assign_rpc', 'off', true);

  select count(*) into v_count from public.step_assignees where step_id = p_step;
  if coalesce(p_mode, s.assignment_mode) = 'individual' and s.plan_status = 'approved' then
    perform public.recompute_individual_step(p_step, null);
  end if;
  return v_count;
end $$;

-- تسجيل إنجاز شخص في مهمة فردية (الشخص نفسه، أو مدير الإدارة نيابة عنه)
create or replace function public.set_assignee_progress(p_step uuid, p_done boolean, p_note text default null, p_user uuid default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare s record; v_user uuid := coalesce(p_user, auth.uid()); v_name text;
begin
  select st.*, op.department_id as dept into s from public.steps st join public.op_plans op on op.id = st.plan_id where st.id = p_step;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if s.assignment_mode <> 'individual' then raise exception 'هذه مهمة مشتركة؛ يُسجل إنجازها مرة واحدة للمهمة'; end if;
  if not public.can_update_step(p_step) then raise exception 'لا تملك صلاحية تحديث هذه المهمة أو أن الخطة غير معتمدة' using errcode = '42501'; end if;
  if v_user <> auth.uid() and not (public.is_ed() or public.is_manager_of(s.dept)) then
    raise exception 'تسجيل إنجاز الآخرين من صلاحية مدير الإدارة' using errcode = '42501';
  end if;
  if not exists (select 1 from public.step_assignees where step_id = p_step and user_id = v_user) then
    raise exception 'الشخص غير مكلف بهذه المهمة';
  end if;
  if p_done and s.output_policy <> 'none' and coalesce(trim(p_note), '') = '' then
    raise exception 'اكتب ما أنجزته (المخرج المتحقق) قبل تسجيل الإكمال';
  end if;
  update public.step_assignees set status = case when p_done then 'completed' else 'not_started' end::public.step_status,
         done_at = case when p_done then now() else null end, note = coalesce(p_note, note)
   where step_id = p_step and user_id = v_user;
  select full_name into v_name from public.profiles where id = v_user;
  return public.recompute_individual_step(p_step, format('%s: %s%s', v_name, case when p_done then 'أنجز' else 'أُلغي إنجازه' end,
                                                        case when coalesce(p_note, '') <> '' then ' — ' || p_note else '' end));
end $$;

-- ---------------------------------------------------------------------
-- 3) تحديث الإنجاز مع التحقق من المخرج المتحقق
-- ---------------------------------------------------------------------
drop function if exists public.update_step_progress(uuid, public.step_status, text, uuid[]);
create or replace function public.update_step_progress(
  p_step uuid,
  p_status public.step_status,
  p_note text default null,
  p_done_substeps uuid[] default null,
  p_output_achieved text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_has_sub boolean;
  v_progress numeric;
  v_status public.step_status := p_status;
  v_output text;
begin
  if not public.can_update_step(p_step) then
    raise exception 'لا تملك صلاحية تحديث هذه المهمة أو أن الخطة غير معتمدة' using errcode = '42501';
  end if;
  select * into s from public.steps where id = p_step for update;
  if s.assignment_mode = 'individual' then
    raise exception 'هذه مهمة فردية؛ يسجل كل مكلف إنجازه من صفحة المهمة';
  end if;
  v_has_sub := exists (select 1 from public.substeps where step_id = p_step);
  v_output := coalesce(nullif(trim(p_output_achieved), ''), s.output_achieved);

  if v_has_sub then
    if p_done_substeps is not null then
      update public.substeps
         set is_done = (id = any(p_done_substeps)),
             done_at = case when id = any(p_done_substeps) then coalesce(done_at, now()) else null end,
             done_by = case when id = any(p_done_substeps) then coalesce(done_by, auth.uid()) else null end
       where step_id = p_step;
    end if;
    select coalesce(sum(weight) filter (where is_done), 0) into v_progress from public.substeps where step_id = p_step;
    v_progress := least(100, round(v_progress, 2));
    if v_progress >= 99.995 then
      v_progress := 100;
      if v_status <> 'on_hold' then v_status := 'completed'; end if;
    elsif v_status = 'completed' then
      raise exception 'لا يمكن إكمال الخطوة قبل إكمال جميع مراحلها الفرعية';
    elsif v_progress > 0 and v_status = 'not_started' then
      v_status := 'in_progress';
    end if;
  else
    v_progress := case when v_status = 'completed' then 100 else 0 end;
  end if;

  -- توثيق المخرج عند الإكمال حسب طبيعة المهمة (الإرفاق وحده لا يعني الاكتمال)
  if v_status = 'completed' and s.status <> 'completed' then
    if s.output_policy in ('description','evidence') and coalesce(trim(v_output), '') = '' then
      raise exception 'اكتب المخرج المتحقق قبل إكمال المهمة';
    end if;
    if s.output_policy = 'evidence' and not exists (select 1 from public.evidence where step_id = p_step) then
      raise exception 'هذه المهمة تتطلب شاهدًا (ملفًا أو رابطًا) قبل إكمالها';
    end if;
  end if;

  update public.steps set
    status = v_status,
    progress = v_progress,
    output_achieved = v_output,
    actual_start = case when v_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when v_status = 'completed' then coalesce(actual_end, current_date) else null end,
    last_update_at = now(),
    last_update_by = auth.uid()
  where id = p_step;

  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
  values (p_step, s.plan_id, auth.uid(), s.status, v_status, s.progress, v_progress, p_note);
  return v_progress;
end $$;

-- حفظ المخرج المتحقق دون تغيير الحالة
create or replace function public.save_step_output(p_step uuid, p_output text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not public.can_update_step(p_step) then
    raise exception 'لا تملك صلاحية على هذه المهمة' using errcode = '42501';
  end if;
  select * into s from public.steps where id = p_step;
  update public.steps set output_achieved = nullif(trim(p_output), ''), last_update_at = now(), last_update_by = auth.uid() where id = p_step;
  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
  values (p_step, s.plan_id, auth.uid(), s.status, s.status, s.progress, s.progress, 'حُدّث المخرج المتحقق');
end $$;

-- تعديل تواريخ المهمة (مدير الإدارة أو المدير التنفيذي) — يُسجل في سجل التغييرات
create or replace function public.set_step_dates(p_step uuid, p_start date, p_end date) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select st.*, op.status as plan_status into s from public.steps st join public.op_plans op on op.id = st.plan_id where st.id = p_step;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if not public.can_manage_plan(s.plan_id) or s.plan_status = 'archived' then
    raise exception 'تعديل التواريخ من صلاحية مدير الإدارة والمدير التنفيذي' using errcode = '42501';
  end if;
  if p_start is null and p_end is null then
    update public.steps set dates_source = 'weeks' where id = p_step;
    perform public.derive_step_dates(p_step);
    return;
  end if;
  if p_start is null or p_end is null then raise exception 'حدد تاريخ البداية والنهاية معًا'; end if;
  if p_end < p_start then raise exception 'تاريخ النهاية قبل تاريخ البداية'; end if;
  update public.steps set start_date = p_start, end_date = p_end, dates_source = 'manual' where id = p_step;
end $$;

-- سياسة توثيق المخرج (يحددها مدير الإدارة)
create or replace function public.set_step_output_policy(p_step uuid, p_policy text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_plan(public.step_plan(p_step)) then
    raise exception 'من صلاحية مدير الإدارة' using errcode = '42501';
  end if;
  update public.steps set output_policy = p_policy where id = p_step;
end $$;

-- ---------------------------------------------------------------------
-- 4) الشواهد: ملفات أو روابط
-- ---------------------------------------------------------------------
alter table public.evidence add column if not exists kind text not null default 'file';
alter table public.evidence add column if not exists url text;
alter table public.evidence alter column storage_path drop not null;
do $$ begin
  alter table public.evidence add constraint evidence_kind_chk check (
    (kind = 'file' and storage_path is not null) or (kind = 'link' and url ~* '^https?://'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 5) الحسابات: تغيير كلمة المرور عند أول دخول
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- لا يُلغي المستخدم بنفسه اشتراط تغيير كلمة المرور إلا عبر clear_must_change_password بعد تغييرها فعلًا
create or replace function public.guard_must_change_password() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_client_session() and new.must_change_password is distinct from old.must_change_password
     and not (public.is_ed() or public.is_sysadmin()) then
    raise exception 'لا يمكن تعديل هذا الحقل مباشرة' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_must_change on public.profiles;
create trigger trg_guard_must_change before update on public.profiles for each row execute function public.guard_must_change_password();

create or replace function public.clear_must_change_password() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 6) روابط عرض الأداء
-- ---------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(token) >= 32),
  name text not null,
  follow_current boolean not null default true,     -- يعرض الربع الحالي دائمًا
  year int,
  quarter smallint check (quarter between 1 and 4),
  allow_period_switch boolean not null default false,
  show_operational boolean not null default true,
  show_executive boolean not null default true,
  show_activities boolean not null default false,   -- التعمق في أسماء المشاريع والأنشطة ونسبها
  kpi_ids uuid[],                                    -- مؤشرات مختارة (فارغ = كل المؤشرات بحسب الأولوية)
  kpi_limit int not null default 9 check (kpi_limit between 1 and 40),
  refresh_seconds int not null default 300 check (refresh_seconds between 30 and 3600),
  access_code_hash text,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0
);
alter table public.share_links add column if not exists failed_attempts int not null default 0;
alter table public.share_links add column if not exists locked_until timestamptz;
alter table public.share_links enable row level security;
drop policy if exists share_links_ed on public.share_links;
create policy share_links_ed on public.share_links for all to authenticated using (public.is_ed()) with check (public.is_ed());
grant select, insert, update, delete on public.share_links to authenticated;
revoke all on public.share_links from anon;

drop trigger if exists trg_touch_share_links on public.share_links;
create trigger trg_touch_share_links before update on public.share_links for each row execute function public.touch_updated_at();

-- سجل مختصر لا يخزن الرمز ولا رمز الوصول
create or replace function public.audit_share_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, actor)
  values ('share_links', coalesce(new.id, old.id)::text, tg_op,
          case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'is_active', old.is_active, 'expires_at', old.expires_at) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'is_active', new.is_active, 'expires_at', new.expires_at, 'protected', new.access_code_hash is not null) end,
          auth.uid());
  return coalesce(new, old);
end $$;
drop trigger if exists audit_share_links on public.share_links;
create trigger audit_share_links after insert or update or delete on public.share_links for each row execute function public.audit_share_link();

create or replace function public.set_share_link_code(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_ed() then raise exception 'من صلاحية المدير التنفيذي' using errcode = '42501'; end if;
  if p_code is not null and trim(p_code) <> '' and length(trim(p_code)) < 6 then raise exception 'رمز الوصول 6 أحرف على الأقل'; end if;
  update public.share_links set access_code_hash = case when p_code is null or trim(p_code) = '' then null else crypt(trim(p_code), gen_salt('bf')) end,
         failed_attempts = 0, locked_until = null
   where id = p_id;
end $$;

-- التحقق من الرابط (متاح للزائر دون تسجيل دخول) — لا يعيد الرمز ولا أي بيانات حساسة
create or replace function public.share_check(p_token text, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l record;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into l from public.share_links where token = p_token;
  if not found or not l.is_active or l.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if l.expires_at is not null and l.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if l.access_code_hash is not null then
    if l.locked_until is not null and l.locked_until > now() then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'name', l.name);
    end if;
    if p_code is null or p_code = '' then
      return jsonb_build_object('ok', false, 'reason', 'code_required', 'name', l.name);
    end if;
    if crypt(p_code, l.access_code_hash) <> l.access_code_hash then
      -- قفل مؤقت بعد 8 محاولات خاطئة متتالية للحد من التخمين
      update public.share_links
         set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
       where id = l.id;
      return jsonb_build_object('ok', false, 'reason', 'code_invalid', 'name', l.name);
    end if;
    if l.failed_attempts > 0 then update public.share_links set failed_attempts = 0, locked_until = null where id = l.id; end if;
  end if;
  return jsonb_build_object('ok', true, 'name', l.name);
end $$;

-- بيانات لوحة العرض: أرقام معتمدة فقط وفق إعدادات الرابط
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
                                   'kpi_limit', l.kpi_limit, 'refresh_seconds', l.refresh_seconds),
    'departments', v_depts, 'weights', v_weights, 'weeks', v_weeks, 'facts', v_facts, 'exec', v_exec,
    'generated_at', now());
end $$;

revoke execute on function public.share_check(text, text) from public;
revoke execute on function public.share_dashboard(text, text, int, int) from public;
grant execute on function public.share_check(text, text) to anon, authenticated;
grant execute on function public.share_dashboard(text, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) حقائق الإنجاز: إضافة التواريخ (يعاد إنشاؤها لتغير أعمدة الإرجاع)
-- ---------------------------------------------------------------------
drop function if exists public.get_progress_facts(int, int);
create or replace function public.get_progress_facts(p_year int, p_quarter int default null)
returns table(
  department_id uuid, plan_id uuid, quarter smallint, plan_status public.plan_status, plan_version int,
  activity_id uuid, activity_weight numeric, activity_kind public.activity_kind,
  step_id uuid, step_weight numeric, step_progress numeric, step_status public.step_status,
  weeks smallint[], last_update_at timestamptz, actual_end date,
  start_date date, end_date date, dates_source text
)
language sql stable security definer set search_path = public as $$
  select op.department_id, op.id, op.quarter, op.status, op.version,
         a.id, a.weight, a.kind,
         s.id, s.weight, s.progress, s.status,
         coalesce((select array_agg(w.week_index order by w.week_index) from public.step_weeks w where w.step_id = s.id), '{}'),
         s.last_update_at, s.actual_end,
         s.start_date, s.end_date, s.dates_source
    from public.op_plans op
    join public.activities a on a.plan_id = op.id and not a.is_archived
    left join public.steps s on s.activity_id = a.id and not s.is_archived
   where op.year = p_year
     and (p_quarter is null or op.quarter = p_quarter)
     and public.is_active_user()
$$;

-- ---------------------------------------------------------------------
-- 8) السجل والصلاحيات
-- ---------------------------------------------------------------------
drop trigger if exists audit_steps on public.steps;
create trigger audit_steps after insert or delete or update of weight, title, is_core, is_archived, assignee_id, responsible_text,
  start_date, end_date, output_policy, assignment_mode, completion_threshold on public.steps
  for each row execute function public.audit_trigger();
drop trigger if exists audit_step_assignees on public.step_assignees;
create trigger audit_step_assignees after insert or delete on public.step_assignees for each row execute function public.audit_trigger();

grant execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean) to authenticated;
grant execute on function public.set_assignee_progress(uuid, boolean, text, uuid) to authenticated;
grant execute on function public.update_step_progress(uuid, public.step_status, text, uuid[], text) to authenticated;
grant execute on function public.save_step_output(uuid, text) to authenticated;
grant execute on function public.set_step_dates(uuid, date, date) to authenticated;
grant execute on function public.set_step_output_policy(uuid, text) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.set_share_link_code(uuid, text) to authenticated;
grant execute on function public.get_progress_facts(int, int) to authenticated;
revoke execute on function public.derive_step_dates(uuid) from public, anon, authenticated;
revoke execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean) from anon;
revoke execute on function public.set_assignee_progress(uuid, boolean, text, uuid) from anon;
revoke execute on function public.update_step_progress(uuid, public.step_status, text, uuid[], text) from anon;
revoke execute on function public.get_progress_facts(int, int) from anon;

-- الإجراءات للمستخدمين المسجلين فقط، عدا دالتي لوحة العرض العامة
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public._insert_step_json(uuid, uuid, jsonb) from authenticated;
revoke execute on function public.default_quarter_weeks(int) from authenticated;
revoke execute on function public.plan_snapshot(uuid) from authenticated;
revoke execute on function public.derive_step_dates(uuid) from authenticated;
revoke execute on function public.recompute_individual_step(uuid, text) from authenticated;
grant execute on function public.share_check(text, text) to anon;
grant execute on function public.share_dashboard(text, text, int, int) to anon;

notify pgrst, 'reload schema';
