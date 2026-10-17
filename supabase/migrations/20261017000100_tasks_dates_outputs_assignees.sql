-- =====================================================================
-- التطوير 1: المهام التنفيذية — التواريخ، المخرجات، الإسناد المتعدد
-- ---------------------------------------------------------------------
-- ترحيل إضافي آمن: لا يحذف أي بيانات، ويُكمل السجلات القائمة:
--  * تاريخ البداية والنهاية لكل مهمة (مستخرجان من الجدولة الأسبوعية،
--    أو يدويان يعتمدهما المخول، ولا يُخترع تاريخ بلا أساس).
--  * المخرج المطلوب (output) والمخرج المتحقق (actual_output) وشواهد روابط.
--  * إسناد المهمة لعدة مستخدمين مع مسؤول رئيسي، بنمطين:
--      تعاوني  : سجل إنجاز واحد مشترك.
--      فردي    : لكل مكلف إنجازه، واكتمال المهمة وفق نسبة محددة مسبقًا.
--    في الحالتين تبقى المهمة سجلًا واحدًا بوزن واحد داخل النشاط.
-- =====================================================================

-- ---------- 1) أعمدة المهمة ----------
alter table public.steps
  add column if not exists planned_start date,
  add column if not exists planned_end date,
  add column if not exists dates_source text not null default 'weeks',
  add column if not exists actual_output text,
  add column if not exists output_requirement text not null default 'text',
  add column if not exists assignment_mode text not null default 'collaborative',
  add column if not exists completion_threshold numeric(5,2) not null default 100,
  add column if not exists assign_scope text not null default 'selected';

alter table public.steps
  add constraint steps_dates_source_chk check (dates_source in ('weeks','manual')),
  add constraint steps_output_req_chk check (output_requirement in ('none','text','evidence')),
  add constraint steps_assignment_mode_chk check (assignment_mode in ('collaborative','individual')),
  add constraint steps_threshold_chk check (completion_threshold > 0 and completion_threshold <= 100),
  add constraint steps_assign_scope_chk check (assign_scope in ('selected','all_dept')),
  add constraint steps_dates_order_chk check (planned_start is null or planned_end is null or planned_end >= planned_start);

create index if not exists steps_planned_end_idx on public.steps(planned_end);

comment on column public.steps.output is 'المخرج المطلوب كما ورد في الخطة';
comment on column public.steps.actual_output is 'المخرج المتحقق فعليًا (يُسجل عبر update_step_progress)';
comment on column public.steps.output_requirement is 'none: لا يلزم توثيق، text: وصف المخرج المتحقق، evidence: وصف + شاهد';

-- سجل التحديثات يوثق تغيير المخرج المتحقق أيضًا
alter table public.step_updates add column if not exists actual_output text;

-- ---------- 2) الشواهد: ملفات أو روابط ----------
alter table public.evidence alter column storage_path drop not null;
alter table public.evidence
  add column if not exists kind text not null default 'file',
  add column if not exists url text;
alter table public.evidence
  add constraint evidence_kind_chk check (
    (kind = 'file' and storage_path is not null)
    or (kind = 'link' and url ~* '^https?://[^ ]+$' and length(url) <= 2000)
  );

-- ---------- 3) المكلفون بالمهمة ----------
create table if not exists public.task_assignees (
  step_id uuid not null references public.steps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_lead boolean not null default false,
  -- تُستخدم في النمط الفردي فقط: إنجاز هذا المكلف
  status public.step_status not null default 'not_started',
  completed_at timestamptz,
  output_note text,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (step_id, user_id)
);
create index if not exists task_assignees_user_idx on public.task_assignees(user_id);
create unique index if not exists task_assignees_one_lead on public.task_assignees(step_id) where is_lead;
alter table public.task_assignees enable row level security;

-- ترحيل الإسناد الحالي (مستخدم واحد) كمسؤول رئيسي
insert into public.task_assignees(step_id, user_id, is_lead, status, completed_at)
select s.id, s.assignee_id, true, s.status, case when s.status = 'completed' then s.last_update_at end
  from public.steps s
 where s.assignee_id is not null
on conflict do nothing;

-- ---------- 4) دوال الصلاحية المحدثة ----------
create or replace function public.is_step_assignee(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_assignees ta where ta.step_id = p_step and ta.user_id = auth.uid())
$$;

create or replace function public.has_assignment_in_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_assignees ta join public.steps s on s.id = ta.step_id
                  where s.plan_id = p_plan and ta.user_id = auth.uid() and not s.is_archived)
$$;

create or replace function public.has_assignment_in_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_assignees ta join public.steps s on s.id = ta.step_id
                  where s.activity_id = p_activity and ta.user_id = auth.uid() and not s.is_archived)
$$;

create or replace function public.can_view_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.op_plans op
    where op.id = p_plan and (
      public.is_ed()
      or (public.is_board() and op.status in ('approved','archived'))
      or public.is_manager_of(op.department_id)
      or (public.my_role() in ('employee','dept_manager','system_admin') and op.status in ('approved','archived')
          and public.has_assignment_in_plan(op.id))
    )
  )
$$;

create or replace function public.can_view_plan_row(p_id uuid, p_dept uuid, p_status public.plan_status) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ed()
      or (public.is_board() and p_status in ('approved','archived'))
      or public.is_manager_of(p_dept)
      or (public.my_role() in ('employee','dept_manager','system_admin') and p_status in ('approved','archived')
          and public.has_assignment_in_plan(p_id))
$$;

-- من ليس مديرًا لخطة يرى منها مهامه المسندة فقط
create or replace function public.sees_whole_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ed() or public.is_board()
      or exists (select 1 from public.op_plans op where op.id = p_plan and public.is_manager_of(op.department_id))
$$;

create or replace function public.can_view_step(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.steps s
    where s.id = p_step
      and public.can_view_plan(s.plan_id)
      and (public.sees_whole_plan(s.plan_id) or public.is_step_assignee(s.id))
  )
$$;

create or replace function public.can_view_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.activities a
    where a.id = p_activity
      and public.can_view_plan(a.plan_id)
      and (public.sees_whole_plan(a.plan_id) or public.has_assignment_in_activity(a.id))
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
      and (
        public.is_ed()
        or public.is_manager_of(op.department_id)
        or (public.my_role() in ('employee','dept_manager') and public.is_step_assignee(s.id))
      )
  )
$$;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (
  public.can_view_plan(plan_id) and (public.sees_whole_plan(plan_id) or public.has_assignment_in_activity(id)));

drop policy if exists steps_select on public.steps;
create policy steps_select on public.steps for select to authenticated using (
  public.can_view_plan(plan_id) and (public.sees_whole_plan(plan_id) or public.is_step_assignee(id)));

create policy task_assignees_select on public.task_assignees for select to authenticated using (public.can_view_step(step_id));
revoke insert, update, delete on public.task_assignees from authenticated;
grant select on public.task_assignees to authenticated;
grant all on public.task_assignees to service_role;

-- ---------- 5) حماية أعمدة المهمة الجديدة ----------
create or replace function public.guard_step() returns trigger
language plpgsql set search_path = public as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
  v_dept uuid;
  v_assignee_dept uuid;
begin
  if not public.is_client_session() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.plan_id <> (select plan_id from public.activities where id = new.activity_id) then
      raise exception 'الخطوة يجب أن تتبع خطة النشاط نفسه';
    end if;
    if new.status <> 'not_started' or new.progress <> 0 then
      raise exception 'الإنجاز يسجل بعد الاعتماد عبر تحديث المهمة';
    end if;
    if new.actual_output is not null or new.dates_source <> 'weeks' or new.planned_start is not null or new.planned_end is not null
       or new.assignment_mode <> 'collaborative' or new.assign_scope <> 'selected' then
      raise exception 'التواريخ والإسناد والمخرج المتحقق تُضبط بعد إنشاء المهمة عبر إجراءاتها' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.plan_id is distinct from old.plan_id or new.activity_id is distinct from old.activity_id then
      raise exception 'لا يمكن نقل الخطوة' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.progress is distinct from old.progress
       or new.last_update_at is distinct from old.last_update_at or new.last_update_by is distinct from old.last_update_by
       or new.actual_output is distinct from old.actual_output then
      raise exception 'تحديث الإنجاز والمخرج المتحقق يتم عبر update_step_progress فقط' using errcode = '42501';
    end if;
    if new.planned_start is distinct from old.planned_start or new.planned_end is distinct from old.planned_end
       or new.dates_source is distinct from old.dates_source then
      raise exception 'تعديل تاريخ البداية والنهاية يتم عبر set_step_dates' using errcode = '42501';
    end if;
    if new.assignment_mode is distinct from old.assignment_mode or new.completion_threshold is distinct from old.completion_threshold
       or new.assign_scope is distinct from old.assign_scope then
      raise exception 'إعدادات الإسناد تتم عبر set_step_assignees' using errcode = '42501';
    end if;
    -- التفويض المباشر (التوافق مع الإصدارات السابقة): مستخدم نشط من الإدارة نفسها
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
      select department_id into v_dept from public.op_plans where id = new.plan_id;
      select department_id into v_assignee_dept from public.profiles where id = new.assignee_id and is_active;
      if not found then
        raise exception 'المستخدم المسند إليه غير نشط';
      end if;
      if not public.is_ed() and v_assignee_dept is distinct from v_dept then
        raise exception 'يمكن تفويض موظفي الإدارة نفسها فقط';
      end if;
    end if;
  end if;
  if public.plan_is_locked(v_plan) then
    if tg_op in ('INSERT','DELETE') then
      raise exception 'الخطة معتمدة: إضافة أو حذف الخطوات يتم عبر طلب تعديل' using errcode = '42501';
    end if;
    if new.weight is distinct from old.weight or new.title is distinct from old.title
       or new.is_core is distinct from old.is_core or new.is_archived is distinct from old.is_archived
       or new.seq is distinct from old.seq then
      raise exception 'الخطة معتمدة: تعديل الأوزان أو العناوين يتم عبر طلب تعديل' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- مزامنة الإسناد المباشر القديم (assignee_id) مع جدول المكلفين
create or replace function public.sync_legacy_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rw.assignees_sync', true), '') = 'off' then
    return new;
  end if;
  delete from public.task_assignees where step_id = new.id;
  if new.assignee_id is not null then
    insert into public.task_assignees(step_id, user_id, is_lead, assigned_by)
    values (new.id, new.assignee_id, true, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_legacy_assignee on public.steps;
create trigger trg_sync_legacy_assignee after update of assignee_id on public.steps
  for each row when (new.assignee_id is distinct from old.assignee_id)
  execute function public.sync_legacy_assignee();

-- ---------- 6) التواريخ ----------
-- نافذة الجدولة الأسبوعية للمهمة (من حدود أسابيع الربع المعتمدة)
create or replace function public.step_week_window(p_step uuid, out w_start date, out w_end date)
language sql stable security definer set search_path = public as $$
  select min(q.start_date), max(q.end_date)
    from public.step_weeks w
    join public.steps s on s.id = w.step_id
    join public.op_plans op on op.id = s.plan_id
    join public.quarter_weeks q on q.year = op.year and q.quarter = op.quarter and q.week_index = w.week_index
   where w.step_id = p_step
$$;

create or replace function public.refresh_step_dates(p_step uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.step_week_window(p_step);
  update public.steps set planned_start = v.w_start, planned_end = v.w_end
   where id = p_step and dates_source = 'weeks'
     and (planned_start is distinct from v.w_start or planned_end is distinct from v.w_end);
end $$;

create or replace function public.trg_step_weeks_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_step_dates(coalesce(new.step_id, old.step_id));
  return null;
end $$;
drop trigger if exists trg_step_weeks_dates on public.step_weeks;
create trigger trg_step_weeks_dates after insert or update or delete on public.step_weeks
  for each row execute function public.trg_step_weeks_dates();

create or replace function public.trg_quarter_weeks_dates() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct s.id from public.steps s join public.op_plans op on op.id = s.plan_id
            join public.step_weeks w on w.step_id = s.id
           where op.year = new.year and op.quarter = new.quarter and w.week_index = new.week_index and s.dates_source = 'weeks' loop
    perform public.refresh_step_dates(r.id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_quarter_weeks_dates on public.quarter_weeks;
create trigger trg_quarter_weeks_dates after update of start_date, end_date on public.quarter_weeks
  for each row execute function public.trg_quarter_weeks_dates();

-- استكمال السجلات القائمة من جدولتها الأسبوعية
do $$ declare r record; begin
  for r in select id from public.steps loop perform public.refresh_step_dates(r.id); end loop;
end $$;

/**
 * تعديل تاريخ البداية والنهاية من المخول (المدير التنفيذي أو مدير الإدارة).
 * تمرير قيمتين فارغتين يعيد التواريخ إلى ما تقتضيه الجدولة الأسبوعية.
 * مع p_sync_weeks تُحدث أسابيع التنفيذ لتطابق الفترة الجديدة داخل الربع.
 */
create or replace function public.set_step_dates(p_step uuid, p_start date, p_end date, p_sync_weeks boolean default true, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  op record;
begin
  select * into s from public.steps where id = p_step for update;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  select o.*, y.status as year_status into op from public.op_plans o join public.years y on y.year = o.year where o.id = s.plan_id;
  if not public.can_manage_plan(s.plan_id) or op.status = 'archived' or op.year_status = 'archived' then
    raise exception 'تعديل تواريخ المهمة من صلاحية المدير التنفيذي ومدير الإدارة' using errcode = '42501';
  end if;
  if (p_start is null) <> (p_end is null) then
    raise exception 'حدد تاريخ البداية والنهاية معًا';
  end if;
  if p_start is not null and p_end < p_start then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;

  if p_start is null then
    update public.steps set dates_source = 'weeks' where id = p_step;
    perform public.refresh_step_dates(p_step);
  else
    update public.steps set dates_source = 'manual', planned_start = p_start, planned_end = p_end where id = p_step;
    if p_sync_weeks then
      delete from public.step_weeks w where w.step_id = p_step
        and not exists (select 1 from public.quarter_weeks q where q.year = op.year and q.quarter = op.quarter
                         and q.week_index = w.week_index and q.start_date <= p_end and q.end_date >= p_start);
      insert into public.step_weeks(step_id, week_index)
      select p_step, q.week_index from public.quarter_weeks q
       where q.year = op.year and q.quarter = op.quarter and q.start_date <= p_end and q.end_date >= p_start
      on conflict do nothing;
    end if;
  end if;

  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
  values (p_step, s.plan_id, auth.uid(), s.status, s.status, s.progress, s.progress,
          coalesce(nullif(trim(p_reason), ''), 'تعديل فترة التنفيذ') || ': ' ||
          coalesce(to_char(p_start, 'YYYY-MM-DD') || ' ← ' || to_char(p_end, 'YYYY-MM-DD'), 'حسب الجدولة الأسبوعية'));
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, actor)
  values ('steps', p_step::text, 'SET_DATES',
          jsonb_build_object('planned_start', s.planned_start, 'planned_end', s.planned_end, 'dates_source', s.dates_source),
          jsonb_build_object('planned_start', p_start, 'planned_end', p_end), auth.uid());
end $$;

-- ---------- 7) الإسناد المتعدد ----------
-- إعادة احتساب إنجاز المهمة الفردية من إنجاز مكلفيها
create or replace function public._recompute_individual(p_step uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  n int;
  d int;
  started int;
  v_frac numeric;
  v_progress numeric;
  v_status public.step_status;
begin
  select * into s from public.steps where id = p_step for update;
  if s.assignment_mode <> 'individual' then return; end if;
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status in ('in_progress','completed'))
    into n, d, started from public.task_assignees where step_id = p_step;
  if n = 0 then
    v_progress := 0;
    v_status := case when s.status = 'on_hold' then 'on_hold' else 'not_started' end;
  else
    v_frac := d::numeric * 100 / n;
    if v_frac + 0.005 >= s.completion_threshold then
      v_progress := 100;
      v_status := 'completed';
    else
      v_progress := least(100, round(v_frac * 100 / s.completion_threshold, 2));
      v_status := case when s.status = 'on_hold' then 'on_hold' when started > 0 then 'in_progress' else 'not_started' end;
    end if;
  end if;
  if v_progress is distinct from s.progress or v_status is distinct from s.status then
    update public.steps set
      progress = v_progress,
      status = v_status,
      actual_start = case when v_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
      actual_end = case when v_status = 'completed' then coalesce(actual_end, current_date) else null end,
      last_update_at = now(),
      last_update_by = auth.uid()
    where id = p_step;
    insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
    values (p_step, s.plan_id, auth.uid(), s.status, v_status, s.progress, v_progress,
            format('إنجاز المكلفين: %s من %s', coalesce(d, 0), coalesce(n, 0)));
  end if;
end $$;

/**
 * تحديد المكلفين بالمهمة.
 *  p_users     : قائمة المستخدمين (يتجاهلها p_all_dept)
 *  p_lead      : المسؤول الرئيسي (اختياري؛ للمكلف الوحيد يكون هو)
 *  p_mode      : collaborative | individual
 *  p_threshold : نسبة المكلفين المطلوبة لاكتمال المهمة الفردية (100 = الجميع)
 *  p_all_dept  : جميع الموظفين النشطين في إدارة الخطة
 */
create or replace function public.set_step_assignees(
  p_step uuid,
  p_users uuid[],
  p_lead uuid default null,
  p_mode text default null,
  p_threshold numeric default null,
  p_all_dept boolean default false
) returns int language plpgsql security definer set search_path = public as $$
declare
  s record;
  op record;
  v_users uuid[];
  v_lead uuid;
  v_mode text;
  v_bad int;
  v_count int;
begin
  select * into s from public.steps where id = p_step for update;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  select o.*, y.status as year_status into op from public.op_plans o join public.years y on y.year = o.year where o.id = s.plan_id;
  if not public.can_manage_plan(s.plan_id) or op.status = 'archived' or op.year_status = 'archived' or s.is_archived then
    raise exception 'إسناد المهام من صلاحية المدير التنفيذي ومدير الإدارة' using errcode = '42501';
  end if;
  v_mode := coalesce(p_mode, s.assignment_mode);
  if v_mode not in ('collaborative','individual') then raise exception 'نمط إسناد غير صالح'; end if;
  if v_mode = 'individual' and exists (select 1 from public.substeps where step_id = p_step) then
    raise exception 'المهمة المقسمة إلى مراحل فرعية لا تكون فردية؛ ألغِ التقسيم أو اجعلها تعاونية';
  end if;
  if p_threshold is not null and (p_threshold <= 0 or p_threshold > 100) then
    raise exception 'نسبة الاكتمال بين 1 و100';
  end if;

  if p_all_dept then
    select coalesce(array_agg(p.id order by p.full_name), '{}') into v_users from public.profiles p
     where p.is_active and p.department_id = op.department_id and p.role in ('employee','dept_manager');
    if cardinality(v_users) = 0 then raise exception 'لا يوجد موظفون نشطون في هذه الإدارة'; end if;
  else
    select coalesce(array_agg(distinct u), '{}') into v_users from unnest(coalesce(p_users, '{}')) u;
  end if;

  -- صلاحية المكلفين: مستخدمون نشطون بأدوار تنفيذية، ومن الإدارة نفسها إن لم يكن المسند هو المدير التنفيذي
  select count(*) into v_bad from unnest(v_users) u
   where not exists (select 1 from public.profiles p where p.id = u and p.is_active
                       and p.role in ('employee','dept_manager','executive_director')
                       and (public.is_ed() or p.department_id = op.department_id));
  if v_bad > 0 then
    raise exception 'بعض المستخدمين غير نشطين أو من خارج الإدارة' using errcode = '42501';
  end if;

  v_lead := case when p_lead = any(v_users) then p_lead
                 when cardinality(v_users) = 1 then v_users[1]
                 else (select ta.user_id from public.task_assignees ta where ta.step_id = p_step and ta.is_lead and ta.user_id = any(v_users)) end;

  perform set_config('rw.assignees_sync', 'off', true);
  delete from public.task_assignees where step_id = p_step and not (user_id = any(v_users));
  update public.task_assignees set is_lead = false where step_id = p_step and is_lead and user_id is distinct from v_lead;
  insert into public.task_assignees(step_id, user_id, is_lead, assigned_by, status)
  select p_step, u, coalesce(u = v_lead, false), auth.uid(), 'not_started' from unnest(v_users) u
  on conflict (step_id, user_id) do update set is_lead = excluded.is_lead, updated_at = now();

  update public.steps set
    assignee_id = v_lead,
    assignment_mode = v_mode,
    completion_threshold = coalesce(p_threshold, completion_threshold),
    assign_scope = case when p_all_dept then 'all_dept' else 'selected' end
  where id = p_step;
  perform set_config('rw.assignees_sync', 'on', true);

  if v_mode = 'individual' and op.status = 'approved' then
    perform public._recompute_individual(p_step);
  end if;

  v_count := cardinality(v_users);
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, actor)
  values ('task_assignees', p_step::text, 'SET_ASSIGNEES', null,
          jsonb_build_object('users', v_users, 'lead', v_lead, 'mode', v_mode, 'all_dept', p_all_dept,
                             'threshold', coalesce(p_threshold, s.completion_threshold)), auth.uid());
  return v_count;
end $$;

-- ---------- 8) تحديث الإنجاز والمخرجات (المسار الوحيد) ----------
-- يتحقق من توثيق المخرج المتحقق قبل إغلاق المهمة. إرفاق ملف وحده لا يغلق المهمة.
create or replace function public._check_output(p_step uuid, p_output text, p_user uuid default null) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_req text;
begin
  select output_requirement into v_req from public.steps where id = p_step;
  if v_req = 'none' then return; end if;
  if nullif(trim(coalesce(p_output, '')), '') is null then
    raise exception 'سجّل المخرج المتحقق قبل إكمال المهمة' using errcode = '23514';
  end if;
  if v_req = 'evidence' and not exists (
       select 1 from public.evidence e where e.step_id = p_step and (p_user is null or e.uploaded_by = p_user)) then
    raise exception 'هذه المهمة تتطلب شاهدًا (ملفًا أو رابطًا) قبل إكمالها' using errcode = '23514';
  end if;
end $$;

drop function if exists public.update_step_progress(uuid, public.step_status, text, uuid[]);
create or replace function public.update_step_progress(
  p_step uuid,
  p_status public.step_status,
  p_note text default null,
  p_done_substeps uuid[] default null,
  p_actual_output text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_has_sub boolean;
  v_progress numeric;
  v_status public.step_status := p_status;
  v_output text;
  a record;
begin
  if not public.can_update_step(p_step) then
    raise exception 'لا تملك صلاحية تحديث هذه المهمة أو أن الخطة غير معتمدة' using errcode = '42501';
  end if;
  select * into s from public.steps where id = p_step for update;

  -- النمط الفردي: كل مكلف يسجل إنجازه، والمهمة تكتمل وفق النسبة المحددة
  if s.assignment_mode = 'individual' then
    select * into a from public.task_assignees where step_id = p_step and user_id = auth.uid();
    if not found then
      raise exception 'هذه مهمة فردية: يسجل كل مكلف إنجازه، ويمكن للمسؤول تحديث حالة مكلف محدد من تفاصيل المهمة';
    end if;
    return public.set_assignee_status(p_step, auth.uid(), p_status, p_note, p_actual_output);
  end if;

  v_output := coalesce(nullif(trim(coalesce(p_actual_output, '')), ''), s.actual_output);
  v_has_sub := exists (select 1 from public.substeps where step_id = p_step);

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
    -- الخطوة دون مراحل: مكتملة = 100٪، وغير ذلك = صفر (بدء العمل لا يعني احتسابها)
    v_progress := case when v_status = 'completed' then 100 else 0 end;
  end if;

  if v_status = 'completed' and s.status is distinct from 'completed' then
    perform public._check_output(p_step, v_output);
  end if;

  update public.steps set
    status = v_status,
    progress = v_progress,
    actual_output = v_output,
    actual_start = case when v_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when v_status = 'completed' then coalesce(actual_end, current_date) else null end,
    last_update_at = now(),
    last_update_by = auth.uid()
  where id = p_step;

  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note, actual_output)
  values (p_step, s.plan_id, auth.uid(), s.status, v_status, s.progress, v_progress, p_note,
          case when v_output is distinct from s.actual_output then v_output end);

  return v_progress;
end $$;

/** حالة مكلف واحد في مهمة فردية (المكلف نفسه، أو المدير التنفيذي / مدير الإدارة) */
create or replace function public.set_assignee_status(
  p_step uuid,
  p_user uuid,
  p_status public.step_status,
  p_note text default null,
  p_output text default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  s record;
  a record;
  v_output text;
begin
  select * into s from public.steps where id = p_step for update;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if s.assignment_mode <> 'individual' then
    raise exception 'هذه مهمة تعاونية بسجل إنجاز واحد؛ حدّثها من زر التحديث';
  end if;
  if not public.can_update_step(p_step) or not (p_user = auth.uid() or public.can_manage_plan(s.plan_id)) then
    raise exception 'لا تملك صلاحية تحديث إنجاز هذا المكلف' using errcode = '42501';
  end if;
  select * into a from public.task_assignees where step_id = p_step and user_id = p_user for update;
  if not found then raise exception 'المستخدم ليس من المكلفين بهذه المهمة'; end if;
  v_output := coalesce(nullif(trim(coalesce(p_output, '')), ''), a.output_note);
  if p_status = 'completed' and a.status is distinct from 'completed' then
    perform public._check_output(p_step, v_output, p_user);
  end if;
  update public.task_assignees set
    status = p_status,
    completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
    output_note = v_output,
    updated_at = now()
  where step_id = p_step and user_id = p_user;
  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note, actual_output)
  values (p_step, s.plan_id, auth.uid(), a.status, p_status, null, null,
          coalesce(nullif(trim(coalesce(p_note, '')), ''), 'تحديث إنجاز مكلف') ||
          case when p_user <> auth.uid() then ' (' || (select full_name from public.profiles where id = p_user) || ')' else '' end,
          case when v_output is distinct from a.output_note then v_output end);
  perform public._recompute_individual(p_step);
  return (select progress from public.steps where id = p_step);
end $$;

-- ملاحظة على المهمة دون تغيير الحالة
create or replace function public.add_step_note(p_step uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not public.can_update_step(p_step) then
    raise exception 'لا تملك صلاحية على هذه المهمة' using errcode = '42501';
  end if;
  select * into s from public.steps where id = p_step;
  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
  values (p_step, s.plan_id, auth.uid(), s.status, s.status, s.progress, s.progress, p_note);
  update public.steps set last_update_at = now(), last_update_by = auth.uid() where id = p_step;
end $$;

-- ---------- 9) حقائق الإنجاز: إضافة التواريخ ----------
drop function if exists public.get_progress_facts(int, int);
create or replace function public.get_progress_facts(p_year int, p_quarter int default null)
returns table(
  department_id uuid, plan_id uuid, quarter smallint, plan_status public.plan_status, plan_version int,
  activity_id uuid, activity_weight numeric, activity_kind public.activity_kind,
  step_id uuid, step_weight numeric, step_progress numeric, step_status public.step_status,
  weeks smallint[], last_update_at timestamptz, actual_end date,
  planned_start date, planned_end date
)
language sql stable security definer set search_path = public as $$
  select op.department_id, op.id, op.quarter, op.status, op.version,
         a.id, a.weight, a.kind,
         s.id, s.weight, s.progress, s.status,
         coalesce((select array_agg(w.week_index order by w.week_index) from public.step_weeks w where w.step_id = s.id), '{}'),
         s.last_update_at, s.actual_end, s.planned_start, s.planned_end
    from public.op_plans op
    join public.activities a on a.plan_id = op.id and not a.is_archived
    left join public.steps s on s.activity_id = a.id and not s.is_archived
   where op.year = p_year
     and (p_quarter is null or op.quarter = p_quarter)
     and public.is_active_user()
$$;

-- ---------- 10) السجل والصلاحيات ----------
create trigger audit_task_assignees after insert or delete on public.task_assignees for each row execute function public.audit_trigger();

-- الدوال الجديدة لا تُتاح افتراضيًا للعموم؛ تُمنح للمستخدمين المسجلين ثم تُسحب الداخلية منها
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public._insert_step_json(uuid, uuid, jsonb) from authenticated;
revoke execute on function public.default_quarter_weeks(int) from authenticated;
revoke execute on function public.plan_snapshot(uuid) from authenticated;
revoke execute on function public._recompute_individual(uuid) from authenticated, anon, public;
revoke execute on function public._check_output(uuid, text, uuid) from authenticated, anon, public;
revoke execute on function public.refresh_step_dates(uuid) from authenticated, anon, public;
grant execute on function public.update_step_progress(uuid, public.step_status, text, uuid[], text) to authenticated;
grant execute on function public.set_assignee_status(uuid, uuid, public.step_status, text, text) to authenticated;
grant execute on function public.set_step_assignees(uuid, uuid[], uuid, text, numeric, boolean) to authenticated;
grant execute on function public.set_step_dates(uuid, date, date, boolean, text) to authenticated;
grant execute on function public.get_progress_facts(int, int) to authenticated;
grant execute on function public.is_step_assignee(uuid), public.has_assignment_in_plan(uuid),
  public.has_assignment_in_activity(uuid), public.sees_whole_plan(uuid), public.step_week_window(uuid) to authenticated;
revoke execute on all functions in schema public from anon;
