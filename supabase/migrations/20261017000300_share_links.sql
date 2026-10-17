-- =====================================================================
-- التطوير 3: روابط عرض الأداء (لوحة خارجية مستقلة)
-- ---------------------------------------------------------------------
-- * الرابط رمز عشوائي (256 بت تقريبًا) لا يكشف أي معرّف داخلي.
-- * الزائر (anon) لا يملك أي صلاحية على الجداول؛ يصل فقط إلى الدالة
--   get_display_data التي تتحقق من الرابط ورمز الوصول والصلاحية، ثم تعيد
--   أرقامًا معتمدة فقط: لا أسماء موظفين، ولا توجيهات، ولا اعتمادات معلقة،
--   ولا ملاحظات، ولا شواهد، ولا عناوين مهام.
-- =====================================================================

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  name text not null check (length(trim(name)) between 1 and 120),
  year int not null references public.years(year),
  quarter smallint check (quarter between 1 and 4),          -- فارغ = الربع الجاري تلقائيًا
  allow_period_nav boolean not null default false,
  sections jsonb not null default '{"ops":true,"departments":true,"curve":true,"exec":true,"activity_titles":false}'::jsonb,
  kpi_ids uuid[],                                              -- مؤشرات بالأولوية (فارغ = كل المؤشرات)
  kpi_limit int not null default 8 check (kpi_limit between 1 and 40),
  access_mode text not null default 'public' check (access_mode in ('public','code')),
  access_code_hash text,
  expires_at timestamptz,
  is_active boolean not null default true,
  revoked_at timestamptz,
  refresh_seconds int not null default 300 check (refresh_seconds between 30 and 3600),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  view_count bigint not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_mode = 'public' or access_code_hash is not null or not is_active)
);
create trigger trg_touch_share_links before update on public.share_links for each row execute function public.touch_updated_at();
create trigger audit_share_links after insert or update of name, is_active, revoked_at, expires_at, access_mode, sections, year, quarter or delete
  on public.share_links for each row execute function public.audit_trigger();

alter table public.share_links enable row level security;
create policy share_links_ed on public.share_links for all to authenticated using (public.is_ed()) with check (public.is_ed());
revoke all on public.share_links from anon;
grant select, insert, update, delete on public.share_links to authenticated;
grant all on public.share_links to service_role;

-- حماية الحقول الحساسة من التعديل المباشر
create or replace function public.guard_share_link() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_client_session() then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.failed_attempts := 0; new.locked_until := null; new.view_count := 0; new.last_viewed_at := null;
      if new.access_code_hash is not null then
        raise exception 'رمز الوصول يُضبط عبر set_share_link_code' using errcode = '42501';
      end if;
    else
      if new.token is distinct from old.token or new.access_code_hash is distinct from old.access_code_hash
         or new.created_by is distinct from old.created_by or new.view_count is distinct from old.view_count then
        raise exception 'لا يمكن تعديل هذه الحقول مباشرة' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_share_link before insert or update on public.share_links for each row execute function public.guard_share_link();

-- رمز الوصول: يخزن مملحًا ومُجزّأً (لا يخزن نصًا صريحًا)
create or replace function public._hash_code(p_salt text, p_code text) returns text
language sql immutable as $$
  select p_salt || '$' || encode(sha256(convert_to(p_salt || ':' || p_code, 'UTF8')), 'hex')
$$;

create or replace function public.set_share_link_code(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_salt text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_ed() then
    raise exception 'إدارة روابط العرض من صلاحية المدير التنفيذي' using errcode = '42501';
  end if;
  if p_code is null then
    update public.share_links set access_mode = 'public', access_code_hash = null, failed_attempts = 0, locked_until = null where id = p_id;
    return;
  end if;
  if length(trim(p_code)) < 4 or length(p_code) > 64 then
    raise exception 'رمز الوصول من 4 إلى 64 خانة';
  end if;
  update public.share_links set access_mode = 'code', access_code_hash = public._hash_code(v_salt, trim(p_code)),
         failed_attempts = 0, locked_until = null where id = p_id;
  if not found then raise exception 'الرابط غير موجود'; end if;
end $$;

-- ---------- بيانات لوحة العرض ----------
create or replace function public.get_display_data(p_token text, p_code text default null, p_year int default null, p_quarter int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  l record;
  v_year int;
  v_quarter int;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_exec record;
  v_salt text;
  v_titles boolean;
  v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into l from public.share_links where token = p_token for update;
  if not found or not l.is_active or l.revoked_at is not null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if l.expires_at is not null and l.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'until', l.locked_until);
  end if;
  if l.access_mode = 'code' then
    if p_code is null or length(p_code) = 0 then
      return jsonb_build_object('status', 'code_required');
    end if;
    v_salt := split_part(l.access_code_hash, '$', 1);
    if public._hash_code(v_salt, trim(p_code)) <> l.access_code_hash then
      update public.share_links set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
       where id = l.id;
      return jsonb_build_object('status', 'code_invalid');
    end if;
    if l.failed_attempts > 0 then
      update public.share_links set failed_attempts = 0, locked_until = null where id = l.id;
    end if;
  end if;

  -- الفترة: ثابتة في الرابط، أو قابلة للتنقل إن سمح بذلك
  v_year := case when l.allow_period_nav and p_year is not null and exists (select 1 from public.years where year = p_year) then p_year else l.year end;
  v_quarter := case when l.allow_period_nav and p_quarter between 1 and 4 then p_quarter
                    when l.quarter is not null then l.quarter
                    when extract(year from v_today) = v_year then extract(quarter from v_today)::int
                    else 4 end;
  v_titles := coalesce((l.sections->>'activity_titles')::boolean, false);

  update public.share_links set view_count = view_count + 1, last_viewed_at = now() where id = l.id;

  select id, title, year into v_exec from public.exec_plans where year = v_year and status in ('approved','archived');

  v_result := jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'link', jsonb_build_object('name', l.name, 'refresh_seconds', l.refresh_seconds, 'sections', l.sections,
                               'allow_period_nav', l.allow_period_nav, 'kpi_limit', l.kpi_limit),
    'period', jsonb_build_object('year', v_year, 'quarter', v_quarter, 'today', v_today),
    'years', case when l.allow_period_nav then (select coalesce(jsonb_agg(year order by year desc), '[]') from public.years) else jsonb_build_array(v_year) end,
    'org', coalesce((select value from public.settings where key = 'org'), '{}'::jsonb),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'short_name', d.short_name, 'sort_order', d.sort_order) order by d.sort_order), '[]')
                      from public.departments d),
    'weights', (with s as (select id from public.dept_weight_sets where year = v_year and status = 'approved' order by version desc limit 1)
                select coalesce(jsonb_agg(jsonb_build_object('department_id', i.department_id, 'weight', i.weight)), '[]')
                  from s join public.dept_weight_items i on i.set_id = s.id),
    'boundaries', (select coalesce(jsonb_agg(jsonb_build_object('quarter', q.quarter, 'week_index', q.week_index, 'month', q.month,
                                   'week_of_month', q.week_of_month, 'start_date', q.start_date, 'end_date', q.end_date) order by q.quarter, q.week_index), '[]')
                     from public.quarter_weeks q where q.year = v_year),
    -- حالة الخطط فقط (بلا محتوى) لتمييز «غير معتمدة» عن «لا توجد خطة»
    'plan_statuses', (select coalesce(jsonb_agg(jsonb_build_object('department_id', op.department_id, 'quarter', op.quarter,
                                      'approved', op.status in ('approved','archived'))), '[]')
                        from public.op_plans op where op.year = v_year),
    -- أرقام الخطط المعتمدة فقط
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', op.id, 'department_id', op.department_id, 'quarter', op.quarter, 'status', op.status,
                'activities', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'weight', a.weight, 'kind', a.kind,
                    'title', case when v_titles then a.title end,
                    'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s.id, 'weight', s.weight, 'progress', s.progress, 'status', s.status,
                        'weeks', coalesce((select jsonb_agg(w.week_index order by w.week_index) from public.step_weeks w where w.step_id = s.id), '[]'),
                        'planned_start', s.planned_start, 'planned_end', s.planned_end,
                        'actual_end', s.actual_end, 'last_update_at', s.last_update_at) order by s.seq), '[]')
                      from public.steps s where s.activity_id = a.id and not s.is_archived)
                  ) order by a.seq), '[]') from public.activities a where a.plan_id = op.id and not a.is_archived)
              )), '[]')
              from public.op_plans op where op.year = v_year and op.status in ('approved','archived')),
    'exec', case when coalesce((l.sections->>'exec')::boolean, true) and v_exec.id is not null then jsonb_build_object(
        'title', v_exec.title,
        'axes', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title) order by x.sort_order), '[]') from public.exec_axes x where x.plan_id = v_exec.id),
        'goals', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'axis_id', g.axis_id, 'title', g.title) order by g.sort_order), '[]') from public.exec_goals g where g.plan_id = v_exec.id),
        'kpis', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', k.id, 'goal_id', k.goal_id, 'name', k.name, 'unit', k.unit, 'kpi_type', k.kpi_type, 'direction', k.direction,
                   'baseline', k.baseline, 'annual_target', k.annual_target, 'department_id', k.department_id, 'frequency', k.frequency,
                   'sort_order', coalesce(array_position(l.kpi_ids, k.id), 1000 + k.sort_order),
                   'targets', (select coalesce(jsonb_object_agg(t.quarter::text, t.target), '{}') from public.kpi_period_targets t where t.kpi_id = k.id),
                   'actual', case when k.actual_mode = 'derived_count' then public.kpi_derived_value(k.id)
                                  else (select m.value from public.kpi_measurements m where m.kpi_id = k.id order by m.measured_on desc, m.recorded_at desc limit 1) end,
                   'measured_on', case when k.actual_mode = 'derived_count' then null
                                  else (select m.measured_on from public.kpi_measurements m where m.kpi_id = k.id order by m.measured_on desc, m.recorded_at desc limit 1) end
                 )), '[]')
                 from public.kpis k where k.plan_id = v_exec.id and (l.kpi_ids is null or cardinality(l.kpi_ids) = 0 or k.id = any(l.kpi_ids)))
      ) else null end
  );
  return v_result;
end $$;

revoke execute on function public._hash_code(text, text) from public, anon, authenticated;
revoke execute on function public.get_display_data(text, text, int, int) from public;
grant execute on function public.get_display_data(text, text, int, int) to anon, authenticated, service_role;
grant execute on function public.set_share_link_code(uuid, text) to authenticated;
revoke execute on function public.set_share_link_code(uuid, text) from public, anon;
revoke execute on function public.guard_share_link() from public, anon;
