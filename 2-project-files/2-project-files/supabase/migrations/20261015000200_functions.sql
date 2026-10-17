-- =====================================================================
-- الدوال المساعدة، القواعد، الإجراءات (RPC) والمحفزات
-- =====================================================================

-- ---------- هوية المستخدم الحالي ----------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.my_dept() returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create or replace function public.is_ed() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'executive_director', false)
$$;

create or replace function public.is_board() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'board_member', false)
$$;

create or replace function public.is_sysadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'system_admin', false)
$$;

create or replace function public.is_manager_of(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'dept_manager' and public.my_dept() = p_dept, false)
$$;

-- هل المستدعي عميل عادي (يخضع للقيود) وليس دالة موثوقة أو خادمًا؟
create or replace function public.is_client_session() returns boolean
language sql stable as $$
  select current_user in ('authenticated','anon')
$$;

-- مستدعٍ موثوق: الخادم بمفتاح الخدمة أو اتصال مباشر بقاعدة البيانات (سكربتات الإعداد)
create or replace function public.is_trusted_caller() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') not in ('authenticated','anon')
$$;

-- ---------- صلاحيات الخطط والخطوات ----------
create or replace function public.can_view_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.op_plans op
    where op.id = p_plan and (
      public.is_ed()
      or (public.is_board() and op.status in ('approved','archived'))
      or public.is_manager_of(op.department_id)
      or (public.my_role() = 'employee' and op.status in ('approved','archived')
          and exists (select 1 from public.steps s where s.plan_id = op.id and s.assignee_id = auth.uid()))
    )
  )
$$;

create or replace function public.can_view_step(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.steps s
    where s.id = p_step
      and public.can_view_plan(s.plan_id)
      and (public.my_role() <> 'employee' or s.assignee_id = auth.uid())
  )
$$;

create or replace function public.can_view_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.activities a
    where a.id = p_activity
      and public.can_view_plan(a.plan_id)
      and (public.my_role() <> 'employee'
           or exists (select 1 from public.steps s where s.activity_id = a.id and s.assignee_id = auth.uid()))
  )
$$;

create or replace function public.can_edit_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.op_plans op
    join public.years y on y.year = op.year
    where op.id = p_plan
      and op.status in ('draft','returned')
      and y.status <> 'archived'
      and (public.is_ed() or public.is_manager_of(op.department_id))
  )
$$;

-- من يدير الخطة (للإسناد والتفويض والطلبات) بغض النظر عن حالتها
create or replace function public.can_manage_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.op_plans op
    where op.id = p_plan and (public.is_ed() or public.is_manager_of(op.department_id))
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
        or (public.my_role() in ('employee','dept_manager') and s.assignee_id = auth.uid())
      )
  )
$$;

-- ---------- السجل العام للتغييرات ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'year', to_jsonb(old)->>'key', to_jsonb(old)->>'step_id');
    insert into public.audit_log(table_name, record_id, action, old_data, actor)
    values (tg_table_name, v_id, tg_op, to_jsonb(old), auth.uid());
    return old;
  end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'year', to_jsonb(new)->>'key', to_jsonb(new)->>'step_id');
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, actor)
  values (tg_table_name, v_id, tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger trg_touch_op_plans before update on public.op_plans for each row execute function public.touch_updated_at();
create trigger trg_touch_activities before update on public.activities for each row execute function public.touch_updated_at();
create trigger trg_touch_steps before update on public.steps for each row execute function public.touch_updated_at();
create trigger trg_touch_exec_plans before update on public.exec_plans for each row execute function public.touch_updated_at();
create trigger trg_touch_kpis before update on public.kpis for each row execute function public.touch_updated_at();
create trigger trg_touch_directives before update on public.directives for each row execute function public.touch_updated_at();

-- ---------- إنشاء ملف المستخدم تلقائيًا ----------
-- الدور والإدارة تُقرأ من app_metadata (لا يكتبها إلا الخادم بمفتاح الخدمة)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role := 'employee';
  v_dept uuid;
begin
  begin
    v_role := coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'employee');
  exception when others then v_role := 'employee';
  end;
  begin
    v_dept := (new.raw_app_meta_data->>'department_id')::uuid;
  exception when others then v_dept := null;
  end;
  -- الحساب لا يُفعَّل إلا إذا أنشأه الخادم بدور محدد (حماية إن فُتح التسجيل الذاتي خطأً)
  insert into public.profiles(id, email, full_name, role, department_id, is_active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), v_role, v_dept,
          coalesce(new.raw_app_meta_data ? 'role', false))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- مزامنة الدور والإدارة عند تحديث app_metadata من الخادم (Auth يحدّثها بعد الإنشاء)
create or replace function public.sync_user_app_metadata() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data ? 'role' then
    begin
      update public.profiles set role = (new.raw_app_meta_data->>'role')::public.app_role,
             is_active = case when not coalesce(old.raw_app_meta_data ? 'role', false) then true else is_active end
       where id = new.id;
    exception when others then null;
    end;
  end if;
  if new.raw_app_meta_data ? 'department_id' then
    begin
      update public.profiles set department_id = nullif(new.raw_app_meta_data->>'department_id', '')::uuid where id = new.id;
    exception when others then null;
    end;
  end if;
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_updated after update of raw_app_meta_data, email on auth.users
  for each row when (new.raw_app_meta_data is distinct from old.raw_app_meta_data or new.email is distinct from old.email)
  execute function public.sync_user_app_metadata();

-- حماية الأدوار من التعديل غير المصرح (ومنع الترقية الذاتية)
create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_client_session() then
    if (new.role is distinct from old.role or new.department_id is distinct from old.department_id
        or new.is_active is distinct from old.is_active or new.email is distinct from old.email) then
      if not (public.is_ed() or public.is_sysadmin()) then
        raise exception 'لا تملك صلاحية تعديل الدور أو الإدارة أو حالة الحساب' using errcode = '42501';
      end if;
      if new.id = auth.uid() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
        raise exception 'لا يمكن تعديل دورك أو حالة حسابك بنفسك' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on public.profiles for each row execute function public.guard_profile_update();

-- ---------- السنوات ----------
create or replace function public.default_quarter_weeks(p_year int) returns void
language plpgsql security definer set search_path = public as $$
declare
  q int; wi int; m int; wom int; s date; e date;
begin
  for q in 1..4 loop
    for wi in 1..12 loop
      m := (q - 1) * 3 + ((wi - 1) / 4) + 1;
      wom := ((wi - 1) % 4) + 1;
      s := make_date(p_year, m, 1 + (wom - 1) * 7);
      if wom < 4 then e := s + 6;
      else e := (date_trunc('month', s) + interval '1 month - 1 day')::date;
      end if;
      insert into public.quarter_weeks(year, quarter, week_index, month, week_of_month, start_date, end_date)
      values (p_year, q, wi, m, wom, s, e)
      on conflict (year, quarter, week_index) do nothing;
    end loop;
  end loop;
end $$;

create or replace function public.create_year(p_year int, p_transitional boolean default false, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_set uuid;
  v_prev uuid;
  v_count int;
begin
  if not (public.is_ed() or public.is_trusted_caller()) then
    raise exception 'إنشاء السنوات من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  insert into public.years(year, status, is_transitional, notes, created_by)
  values (p_year, 'planning', p_transitional, p_notes, auth.uid());
  perform public.default_quarter_weeks(p_year);

  -- أوزان الإدارات: نسخ آخر أوزان معتمدة، وإلا توزيع متساوٍ على الإدارات النشطة
  insert into public.dept_weight_sets(year, version, status, note, created_by, approved_by, approved_at)
  values (p_year, 1, 'approved', 'الإصدار الأول للسنة', auth.uid(), auth.uid(), now())
  returning id into v_set;

  select s.id into v_prev from public.dept_weight_sets s
   where s.status = 'approved' and s.year < p_year
   order by s.year desc, s.version desc limit 1;

  if v_prev is not null then
    insert into public.dept_weight_items(set_id, department_id, weight)
    select v_set, i.department_id, i.weight
      from public.dept_weight_items i join public.departments d on d.id = i.department_id
     where i.set_id = v_prev and d.is_active;
  end if;

  select count(*) into v_count from public.dept_weight_items where set_id = v_set;
  if v_count = 0 or abs((select coalesce(sum(weight),0) from public.dept_weight_items where set_id = v_set) - 100) > 0.01 then
    delete from public.dept_weight_items where set_id = v_set;
    select count(*) into v_count from public.departments where is_active;
    if v_count > 0 then
      insert into public.dept_weight_items(set_id, department_id, weight)
      select v_set, d.id, round(100.0 / v_count, 3) from public.departments d where d.is_active;
      -- تصحيح فرق التقريب في آخر إدارة
      update public.dept_weight_items set weight = weight + (100 - (select sum(weight) from public.dept_weight_items where set_id = v_set))
       where set_id = v_set and department_id = (select d.id from public.departments d where d.is_active order by d.sort_order desc limit 1);
    end if;
  end if;
end $$;

-- أوزان الإدارات المعتمدة لسنة معينة (آخر إصدار معتمد)
create or replace function public.get_dept_weights(p_year int)
returns table(department_id uuid, weight numeric, set_version int)
language sql stable security definer set search_path = public as $$
  with s as (
    select id, version from public.dept_weight_sets
     where year = p_year and status = 'approved'
     order by version desc limit 1
  )
  select i.department_id, i.weight, s.version from s join public.dept_weight_items i on i.set_id = s.id
   where public.is_active_user()
$$;

-- اقتراح/اعتماد إصدار جديد لأوزان الإدارات
create or replace function public.set_dept_weights(p_year int, p_weights jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_set uuid;
  v_sum numeric;
begin
  if not public.is_ed() then
    raise exception 'اعتماد أوزان الإدارات من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  select coalesce(sum((x->>'weight')::numeric), 0) into v_sum from jsonb_array_elements(p_weights) x;
  if abs(v_sum - 100) > 0.01 then
    raise exception 'مجموع أوزان الإدارات يجب أن يساوي 100%% (الحالي %)', v_sum;
  end if;
  if exists (select 1 from jsonb_array_elements(p_weights) x where (x->>'weight')::numeric < 0) then
    raise exception 'لا تقبل الأوزان السالبة';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.dept_weight_sets where year = p_year;
  insert into public.dept_weight_sets(year, version, status, note, created_by, approved_by, approved_at)
  values (p_year, v_version, 'approved', p_note, auth.uid(), auth.uid(), now()) returning id into v_set;
  insert into public.dept_weight_items(set_id, department_id, weight)
  select v_set, (x->>'department_id')::uuid, (x->>'weight')::numeric from jsonb_array_elements(p_weights) x;
  return v_version;
end $$;

create or replace function public.archive_year(p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ed() then
    raise exception 'أرشفة السنة من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  update public.op_plans set status = 'archived', archived_at = now() where year = p_year and status = 'approved';
  update public.exec_plans set status = 'archived' where year = p_year and status = 'approved';
  update public.years set status = 'archived', archived_at = now(), archived_by = auth.uid() where year = p_year;
end $$;

-- ---------- قيود الخطط المعتمدة ----------
create or replace function public.plan_is_locked(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status not in ('draft','returned') from public.op_plans where id = p_plan), true)
$$;

create or replace function public.guard_op_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_client_session() then
    if tg_op = 'UPDATE' then
      if new.status is distinct from old.status then
        raise exception 'تغيير حالة الخطة يتم عبر إجراءات الاعتماد فقط' using errcode = '42501';
      end if;
      if new.department_id is distinct from old.department_id or new.year is distinct from old.year
         or new.quarter is distinct from old.quarter or new.version is distinct from old.version
         or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
        raise exception 'لا يمكن تعديل هذه الحقول مباشرة' using errcode = '42501';
      end if;
    elsif tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'تنشأ الخطة كمسودة دائمًا' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_op_plan before insert or update on public.op_plans for each row execute function public.guard_op_plan();

create or replace function public.guard_activity() returns trigger
language plpgsql set search_path = public as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  if not public.is_client_session() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.plan_id is distinct from old.plan_id then
    raise exception 'لا يمكن نقل النشاط إلى خطة أخرى' using errcode = '42501';
  end if;
  if public.plan_is_locked(v_plan) then
    if tg_op in ('INSERT','DELETE') then
      raise exception 'الخطة معتمدة: إضافة أو حذف الأنشطة يتم عبر طلب تعديل' using errcode = '42501';
    end if;
    if new.weight is distinct from old.weight or new.title is distinct from old.title
       or new.kind is distinct from old.kind or new.is_archived is distinct from old.is_archived
       or new.seq is distinct from old.seq then
      raise exception 'الخطة معتمدة: تعديل الأوزان أو العناوين يتم عبر طلب تعديل' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_activity before insert or update or delete on public.activities for each row execute function public.guard_activity();

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
  end if;
  if tg_op = 'UPDATE' then
    if new.plan_id is distinct from old.plan_id or new.activity_id is distinct from old.activity_id then
      raise exception 'لا يمكن نقل الخطوة' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.progress is distinct from old.progress
       or new.last_update_at is distinct from old.last_update_at or new.last_update_by is distinct from old.last_update_by then
      raise exception 'تحديث الإنجاز يتم عبر update_step_progress فقط' using errcode = '42501';
    end if;
    -- التفويض: المسند إليه يجب أن يكون مستخدمًا نشطًا، ومن الإدارة نفسها إذا أسنده مدير الإدارة
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
create trigger trg_guard_step before insert or update or delete on public.steps for each row execute function public.guard_step();

create or replace function public.guard_step_child() returns trigger
language plpgsql set search_path = public as $$
declare
  v_step uuid := coalesce(new.step_id, old.step_id);
  v_plan uuid;
begin
  if not public.is_client_session() then
    return coalesce(new, old);
  end if;
  select plan_id into v_plan from public.steps where id = v_step;
  if public.plan_is_locked(v_plan) then
    raise exception 'الخطة معتمدة: تعديل الجدولة أو المراحل الفرعية يتم عبر طلب تعديل' using errcode = '42501';
  end if;
  if tg_table_name = 'substeps' and tg_op in ('UPDATE','INSERT') then
    if (to_jsonb(new)->>'is_done')::boolean is distinct from coalesce((to_jsonb(old)->>'is_done')::boolean, false) then
      raise exception 'إنجاز المراحل يسجل عبر تحديث المهمة' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_step_weeks before insert or update or delete on public.step_weeks for each row execute function public.guard_step_child();
create trigger trg_guard_substeps before insert or update or delete on public.substeps for each row execute function public.guard_step_child();

-- ---------- التحقق من الأوزان ----------
-- يعيد قائمة بالمشكلات (فارغة = الخطة سليمة)
create or replace function public.plan_weight_issues(p_plan uuid)
returns table(level text, ref_id uuid, message text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_sum numeric;
  r record;
begin
  if not (public.can_view_plan(p_plan) or public.is_trusted_caller()) then
    return;
  end if;
  if not exists (select 1 from public.activities where plan_id = p_plan and not is_archived) then
    return query select 'plan'::text, p_plan, 'لا توجد أنشطة في الخطة'::text;
    return;
  end if;
  select coalesce(sum(weight), 0) into v_sum from public.activities where plan_id = p_plan and not is_archived;
  if abs(v_sum - 100) > 0.01 then
    return query select 'plan'::text, p_plan, format('مجموع أوزان الأنشطة %s%% ويجب أن يساوي 100%%', round(v_sum, 2))::text;
  end if;
  for r in select a.id, a.title,
                  (select count(*) from public.steps s where s.activity_id = a.id and not s.is_archived) as n,
                  (select coalesce(sum(s.weight), 0) from public.steps s where s.activity_id = a.id and not s.is_archived) as w
             from public.activities a where a.plan_id = p_plan and not a.is_archived loop
    if r.n = 0 then
      return query select 'activity'::text, r.id, format('النشاط «%s» بلا خطوات', r.title)::text;
    elsif abs(r.w - 100) > 0.01 then
      return query select 'activity'::text, r.id, format('مجموع أوزان خطوات «%s» = %s%%', r.title, round(r.w, 2))::text;
    end if;
  end loop;
  for r in select s.id, s.title, sum(ss.weight) as w
             from public.steps s join public.substeps ss on ss.step_id = s.id
            where s.plan_id = p_plan and not s.is_archived
            group by s.id, s.title loop
    if abs(r.w - 100) > 0.01 then
      return query select 'step'::text, r.id, format('مجموع أوزان المراحل الفرعية لـ «%s» = %s%%', r.title, round(r.w, 2))::text;
    end if;
  end loop;
end $$;

create or replace function public.plan_snapshot(p_plan uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan_id', p_plan,
    'activities', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'weight', a.weight, 'kind', a.kind,
      'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', s.id, 'title', s.title, 'weight', s.weight, 'is_core', s.is_core,
                  'weeks', (select coalesce(jsonb_agg(w.week_index order by w.week_index), '[]'::jsonb) from public.step_weeks w where w.step_id = s.id),
                  'substeps', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'title', ss.title, 'weight', ss.weight) order by ss.sort_order), '[]'::jsonb) from public.substeps ss where ss.step_id = s.id)
                ) order by s.seq), '[]'::jsonb)
                from public.steps s where s.activity_id = a.id and not s.is_archived)
    ) order by a.seq), '[]'::jsonb))
  from public.activities a where a.plan_id = p_plan and not a.is_archived
$$;

create or replace function public.validate_plan_on_approve() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_msg text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select string_agg(message, ' | ') into v_msg from public.plan_weight_issues(new.id);
    if v_msg is not null then
      raise exception 'لا يمكن اعتماد الخطة: %', v_msg using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_validate_plan_approve before update of status on public.op_plans
  for each row execute function public.validate_plan_on_approve();

-- ---------- دورة الاعتماد ----------
create or replace function public.submit_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_msg text;
begin
  if not public.can_edit_plan(p_plan) then
    raise exception 'لا تملك صلاحية رفع هذه الخطة أو أنها ليست مسودة' using errcode = '42501';
  end if;
  select string_agg(message, ' | ') into v_msg from public.plan_weight_issues(p_plan);
  if v_msg is not null then
    raise exception 'الخطة غير مكتملة: %', v_msg using errcode = '23514';
  end if;
  update public.op_plans set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), return_note = null
   where id = p_plan;
end $$;

create or replace function public.approve_plan(p_plan uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status public.plan_status;
  v_version int;
begin
  if not public.is_ed() then
    raise exception 'الاعتماد من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  select status, version into v_status, v_version from public.op_plans where id = p_plan for update;
  if v_status not in ('draft','submitted','returned') then
    raise exception 'الخطة ليست بانتظار الاعتماد';
  end if;
  update public.op_plans set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_plan;
  insert into public.plan_weight_snapshots(plan_id, version, snapshot, approved_by, reason)
  values (p_plan, v_version, public.plan_snapshot(p_plan), auth.uid(), coalesce(p_note, 'اعتماد الخطة'))
  on conflict (plan_id, version) do update set snapshot = excluded.snapshot, approved_at = now(), approved_by = excluded.approved_by;
  update public.years set status = 'active' where year = (select year from public.op_plans where id = p_plan) and status = 'planning';
end $$;

create or replace function public.return_plan(p_plan uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ed() then
    raise exception 'إعادة الخطة من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  update public.op_plans set status = 'returned', return_note = p_note
   where id = p_plan and status = 'submitted';
  if not found then
    raise exception 'الخطة ليست مرفوعة للاعتماد';
  end if;
end $$;

-- ---------- تحديث الإنجاز (المسار الوحيد لتغيير الإنجاز) ----------
create or replace function public.update_step_progress(
  p_step uuid,
  p_status public.step_status,
  p_note text default null,
  p_done_substeps uuid[] default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_has_sub boolean;
  v_progress numeric;
  v_status public.step_status := p_status;
begin
  if not public.can_update_step(p_step) then
    raise exception 'لا تملك صلاحية تحديث هذه المهمة أو أن الخطة غير معتمدة' using errcode = '42501';
  end if;
  select * into s from public.steps where id = p_step for update;
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

  update public.steps set
    status = v_status,
    progress = v_progress,
    actual_start = case when v_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when v_status = 'completed' then coalesce(actual_end, current_date) else null end,
    last_update_at = now(),
    last_update_by = auth.uid()
  where id = p_step;

  insert into public.step_updates(step_id, plan_id, user_id, from_status, to_status, from_progress, to_progress, note)
  values (p_step, s.plan_id, auth.uid(), s.status, v_status, s.progress, v_progress, p_note);

  return v_progress;
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

-- ---------- طلبات التعديل على الخطة المعتمدة ----------
create or replace function public.request_plan_change(p_plan uuid, p_kind text, p_payload jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_plan(p_plan) then
    raise exception 'لا تملك صلاحية طلب تعديل هذه الخطة' using errcode = '42501';
  end if;
  if (select status from public.op_plans where id = p_plan) <> 'approved' then
    raise exception 'طلبات التعديل للخطط المعتمدة فقط؛ المسودات تعدل مباشرة';
  end if;
  insert into public.change_requests(plan_id, kind, payload, reason, requested_by)
  values (p_plan, p_kind, p_payload, p_reason, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- إدراج خطوة من JSON (تستخدمها طلبات التعديل)
create or replace function public._insert_step_json(p_activity uuid, p_plan uuid, x jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_step uuid;
begin
  insert into public.steps(activity_id, plan_id, seq, title, responsible_text, output, weight, is_core)
  values (p_activity, p_plan,
          coalesce((select max(seq) + 1 from public.steps where activity_id = p_activity), 1),
          x->>'title', x->>'responsible_text', x->>'output',
          coalesce((x->>'weight')::numeric, 0), coalesce((x->>'is_core')::boolean, false))
  returning id into v_step;
  if x ? 'weeks' then
    insert into public.step_weeks(step_id, week_index)
    select v_step, (w::text)::smallint from jsonb_array_elements(x->'weeks') w
    on conflict do nothing;
  end if;
  return v_step;
end $$;

-- payload:
-- { "activities":[{"id":..,"weight":..}], "steps":[{"id":..,"weight":..}],
--   "weeks":[{"step_id":..,"weeks":[1,2]}],
--   "texts":[{"step_id":..,"responsible_text":..,"output":..}],
--   "add_steps":[{"activity_id":..,"title":..,"responsible_text":..,"output":..,"weight":..,"weeks":[..]}],
--   "add_activities":[{"title":..,"kind":..,"weight":..,"steps":[{...}]}],
--   "archive_steps":[id,..], "archive_activities":[id,..] }
create or replace function public.decide_plan_change(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  cr record;
  x jsonb;
  y jsonb;
  v_step uuid;
  v_act uuid;
  v_msg text;
  v_version int;
begin
  if not public.is_ed() then
    raise exception 'البت في طلبات التعديل من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  select * into cr from public.change_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if cr.status <> 'pending' then
    raise exception 'تم البت في هذا الطلب مسبقًا';
  end if;
  if not p_approve then
    update public.change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
    return;
  end if;

  for x in select * from jsonb_array_elements(coalesce(cr.payload->'archive_steps', '[]')) loop
    update public.steps set is_archived = true where id = (x#>>'{}')::uuid and plan_id = cr.plan_id;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'archive_activities', '[]')) loop
    update public.activities set is_archived = true where id = (x#>>'{}')::uuid and plan_id = cr.plan_id;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'activities', '[]')) loop
    update public.activities set weight = (x->>'weight')::numeric where id = (x->>'id')::uuid and plan_id = cr.plan_id;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'steps', '[]')) loop
    update public.steps set weight = (x->>'weight')::numeric where id = (x->>'id')::uuid and plan_id = cr.plan_id;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'texts', '[]')) loop
    update public.steps set
      responsible_text = coalesce(x->>'responsible_text', responsible_text),
      output = coalesce(x->>'output', output)
     where id = (x->>'step_id')::uuid and plan_id = cr.plan_id;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'weeks', '[]')) loop
    v_step := (x->>'step_id')::uuid;
    if exists (select 1 from public.steps where id = v_step and plan_id = cr.plan_id) then
      delete from public.step_weeks where step_id = v_step;
      insert into public.step_weeks(step_id, week_index)
      select v_step, (w::text)::smallint from jsonb_array_elements(x->'weeks') w on conflict do nothing;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'add_steps', '[]')) loop
    if exists (select 1 from public.activities where id = (x->>'activity_id')::uuid and plan_id = cr.plan_id) then
      perform public._insert_step_json((x->>'activity_id')::uuid, cr.plan_id, x);
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cr.payload->'add_activities', '[]')) loop
    insert into public.activities(plan_id, seq, title, kind, weight)
    values (cr.plan_id, coalesce((select max(seq) + 1 from public.activities where plan_id = cr.plan_id), 1),
            x->>'title', coalesce((x->>'kind')::public.activity_kind, 'other'), coalesce((x->>'weight')::numeric, 0))
    returning id into v_act;
    for y in select * from jsonb_array_elements(coalesce(x->'steps', '[]')) loop
      perform public._insert_step_json(v_act, cr.plan_id, y);
    end loop;
  end loop;

  select string_agg(message, ' | ') into v_msg from public.plan_weight_issues(cr.plan_id);
  if v_msg is not null then
    raise exception 'التعديل يخل بالأوزان: %', v_msg using errcode = '23514';
  end if;

  update public.op_plans set version = version + 1 where id = cr.plan_id returning version into v_version;
  insert into public.plan_weight_snapshots(plan_id, version, snapshot, approved_by, reason)
  values (cr.plan_id, v_version, public.plan_snapshot(cr.plan_id), auth.uid(), coalesce(cr.reason, p_note));
  update public.change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
end $$;

-- ---------- حقائق الإنجاز (أرقام فقط، لكل المستخدمين النشطين) ----------
-- يعيد الأرقام اللازمة لمحرك الاحتساب دون أي نصوص، ليظهر الإنجاز الإجمالي
-- لكل من يحق له رؤية اللوحة العامة، بينما تبقى التفاصيل خاضعة لـ RLS.
create or replace function public.get_progress_facts(p_year int, p_quarter int default null)
returns table(
  department_id uuid, plan_id uuid, quarter smallint, plan_status public.plan_status, plan_version int,
  activity_id uuid, activity_weight numeric, activity_kind public.activity_kind,
  step_id uuid, step_weight numeric, step_progress numeric, step_status public.step_status,
  weeks smallint[], last_update_at timestamptz, actual_end date
)
language sql stable security definer set search_path = public as $$
  select op.department_id, op.id, op.quarter, op.status, op.version,
         a.id, a.weight, a.kind,
         s.id, s.weight, s.progress, s.status,
         coalesce((select array_agg(w.week_index order by w.week_index) from public.step_weeks w where w.step_id = s.id), '{}'),
         s.last_update_at, s.actual_end
    from public.op_plans op
    join public.activities a on a.plan_id = op.id and not a.is_archived
    left join public.steps s on s.activity_id = a.id and not s.is_archived
   where op.year = p_year
     and (p_quarter is null or op.quarter = p_quarter)
     and public.is_active_user()
$$;

-- قائمة مختصرة بحالة الخطط لكل إدارة (للوحة العامة)
create or replace function public.get_plan_statuses(p_year int)
returns table(plan_id uuid, department_id uuid, quarter smallint, status public.plan_status, approved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, department_id, quarter, status, approved_at from public.op_plans
   where year = p_year and public.is_active_user()
$$;

-- ---------- مؤشرات الأداء: القيمة المشتقة ----------
-- عدد الأنشطة المرتبطة المكتملة (كل نشاط يحسب مرة واحدة)
create or replace function public.kpi_derived_value(p_kpi uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric from public.activities a
   join public.op_plans op on op.id = a.plan_id and op.status in ('approved','archived')
   where a.kpi_id = p_kpi and not a.is_archived
     and not exists (select 1 from public.steps s where s.activity_id = a.id and not s.is_archived and s.status <> 'completed')
     and exists (select 1 from public.steps s where s.activity_id = a.id and not s.is_archived)
$$;

-- ---------- التوجيهات ----------
create or replace function public.update_directive(p_directive uuid, p_status public.directive_status, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.directives where id = p_directive;
  if not found then raise exception 'التوجيه غير موجود'; end if;
  if not (public.is_ed() or d.assignee_id = auth.uid() or (d.department_id is not null and public.is_manager_of(d.department_id))) then
    raise exception 'لا تملك صلاحية على هذا التوجيه' using errcode = '42501';
  end if;
  if p_status = 'closed' and not public.is_ed() then
    -- المسؤول يرفع المعالجة، والإغلاق النهائي للمدير التنفيذي
    raise exception 'إغلاق التوجيه من صلاحية المدير التنفيذي؛ حدّث الحالة إلى «قيد المعالجة» مع ملاحظة';
  end if;
  update public.directives set status = p_status,
         closed_at = case when p_status = 'closed' then now() else null end
   where id = p_directive;
  insert into public.directive_updates(directive_id, user_id, status, note) values (p_directive, auth.uid(), p_status, p_note);
end $$;

-- ---------- التقارير: نسخة ثابتة ----------
create or replace function public.guard_report() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      raise exception 'لا يمكن حذف تقرير معتمد';
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    raise exception 'التقرير معتمد ولا يمكن تعديله' using errcode = '42501';
  end if;
  if new.snapshot is distinct from old.snapshot or new.type is distinct from old.type
     or new.year is distinct from old.year or new.generated_at is distinct from old.generated_at
     or new.generated_by is distinct from old.generated_by then
    raise exception 'بيانات التقرير ثابتة منذ إصداره ولا يمكن تغييرها' using errcode = '42501';
  end if;
  if new.status = 'approved' then
    if public.is_client_session() and not public.is_ed() then
      raise exception 'اعتماد التقارير من صلاحية المدير التنفيذي' using errcode = '42501';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger trg_guard_report before update or delete on public.reports for each row execute function public.guard_report();

create or replace function public.stamp_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.generated_by := coalesce(auth.uid(), new.generated_by);
  new.generated_at := now();
  new.status := 'draft';
  return new;
end $$;
create trigger trg_stamp_report before insert on public.reports for each row execute function public.stamp_report();

-- ---------- محفزات السجل ----------
create trigger audit_op_plans after insert or update or delete on public.op_plans for each row execute function public.audit_trigger();
create trigger audit_activities after insert or delete or update of weight, title, kind, is_archived, kpi_id on public.activities for each row execute function public.audit_trigger();
create trigger audit_steps after insert or delete or update of weight, title, is_core, is_archived, assignee_id, responsible_text on public.steps for each row execute function public.audit_trigger();
create trigger audit_step_weeks after insert or delete on public.step_weeks for each row execute function public.audit_trigger();
create trigger audit_substeps after insert or delete or update of weight, title on public.substeps for each row execute function public.audit_trigger();
create trigger audit_kpis after insert or update or delete on public.kpis for each row execute function public.audit_trigger();
create trigger audit_kpi_targets after insert or update or delete on public.kpi_period_targets for each row execute function public.audit_trigger();
create trigger audit_kpi_measurements after insert or update or delete on public.kpi_measurements for each row execute function public.audit_trigger();
create trigger audit_exec_plans after insert or update or delete on public.exec_plans for each row execute function public.audit_trigger();
create trigger audit_dept_weight_sets after insert or update on public.dept_weight_sets for each row execute function public.audit_trigger();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.audit_trigger();
create trigger audit_departments after insert or update or delete on public.departments for each row execute function public.audit_trigger();
create trigger audit_years after insert or update on public.years for each row execute function public.audit_trigger();
create trigger audit_quarter_weeks after update on public.quarter_weeks for each row execute function public.audit_trigger();
create trigger audit_change_requests after insert or update on public.change_requests for each row execute function public.audit_trigger();
create trigger audit_directives after insert or update or delete on public.directives for each row execute function public.audit_trigger();
create trigger audit_reports after insert or update or delete on public.reports for each row execute function public.audit_trigger();
create trigger audit_settings after insert or update or delete on public.settings for each row execute function public.audit_trigger();
