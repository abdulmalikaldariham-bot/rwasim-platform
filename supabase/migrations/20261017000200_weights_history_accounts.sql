-- =====================================================================
-- التطوير 2: سجل تعديلات الأوزان + تهيئة الحسابات (كلمة المرور عند أول دخول)
-- =====================================================================

-- ---------- سجل تعديلات الأوزان لخطة ----------
-- يجمع تغييرات أوزان الأنشطة والمهام من السجل العام، ولا يُتاح إلا لمن يدير الخطة.
create or replace function public.get_weight_history(p_plan uuid, p_limit int default 60)
returns table(at timestamptz, actor_name text, item_kind text, item_id uuid, item_title text, old_weight numeric, new_weight numeric, action text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_ed() or public.can_manage_plan(p_plan)) then
    return;
  end if;
  return query
  select l.at, coalesce(p.full_name, 'النظام'),
         case when l.table_name = 'activities' then 'activity' else 'step' end,
         l.record_id::uuid,
         coalesce(l.new_data->>'title', l.old_data->>'title'),
         (l.old_data->>'weight')::numeric,
         (l.new_data->>'weight')::numeric,
         l.action
    from public.audit_log l
    left join public.profiles p on p.id = l.actor
   where l.table_name in ('activities','steps')
     and coalesce(l.new_data->>'plan_id', l.old_data->>'plan_id') = p_plan::text
     and (l.action <> 'UPDATE' or (l.old_data->>'weight') is distinct from (l.new_data->>'weight')
          or (l.old_data->>'is_core') is distinct from (l.new_data->>'is_core'))
   order by l.at desc
   limit greatest(1, least(p_limit, 300));
end $$;

-- ---------- تهيئة الحساب ----------
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- لا يغير المستخدم هذا العلم مباشرة؛ يُرفع بعد تعيين كلمة مرور جديدة عبر password_changed()
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
    if new.must_change_password is distinct from old.must_change_password then
      if new.id = auth.uid() or not (public.is_ed() or public.is_sysadmin()) then
        raise exception 'هذا الإعداد يُضبط عبر تغيير كلمة المرور' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

grant execute on function public.get_weight_history(uuid, int), public.password_changed() to authenticated;
revoke execute on function public.get_weight_history(uuid, int), public.password_changed() from public, anon;
