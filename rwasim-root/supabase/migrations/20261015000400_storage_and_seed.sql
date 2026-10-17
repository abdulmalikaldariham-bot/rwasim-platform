-- =====================================================================
-- التخزين (الشواهد، التقارير، ملفات الاستيراد) + البيانات المرجعية للجمعية
-- =====================================================================

-- ---------- الحاويات (خاصة) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 26214400),
       ('reports', 'reports', false, 26214400),
       ('imports', 'imports', false, 10485760)
on conflict (id) do nothing;

-- المسار: evidence/{plan_id}/{step_id}/{file}
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.can_view_step(((storage.foldername(name))[2])::uuid));
create policy evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.can_update_step(((storage.foldername(name))[2])::uuid));
create policy evidence_remove on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (public.is_ed() or owner_id = auth.uid()::text));

-- المسار: reports/{report_id}/{file}
create policy reports_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and exists (select 1 from public.reports r where r.id::text = (storage.foldername(name))[1]));
create policy reports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and exists (select 1 from public.reports r where r.id::text = (storage.foldername(name))[1]
              and (public.is_ed() or r.generated_by = auth.uid())));

-- المسار: imports/{user_id}/{file}
create policy imports_read on storage.objects for select to authenticated
  using (bucket_id = 'imports' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_ed()));
create policy imports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_ed() or public.my_role() = 'dept_manager'));

-- ---------- الإدارات المعتمدة ----------
insert into public.departments (name, short_name, code, sort_order) values
  ('الإدارة التنفيذية', 'التنفيذية', 'EXEC', 1),
  ('إدارة المشاريع', 'المشاريع', 'PROJ', 2),
  ('إدارة الخدمات المساندة', 'المساندة', 'SUPP', 3),
  ('إدارة الاتصال المؤسسي', 'الاتصال المؤسسي', 'COMM', 4),
  ('إدارة تمكين', 'تمكين', 'TMKN', 5)
on conflict (code) do nothing;

-- ---------- الإعدادات ----------
insert into public.settings (key, value) values
  ('org', '{"name":"جمعية رواسم","platform":"رواسم | منصة الأداء المؤسسي"}'),
  ('stale_after_days', '14'),
  ('core_step_default_weight', '40'),
  ('late_grace_days', '0')
on conflict (key) do nothing;

-- ---------- سنة 2026 (انتقالية) ----------
-- تنشئ السنة وحدود الأسابيع الافتراضية وأوزان الإدارات (20% لكل إدارة)
select public.create_year(2026, true, 'سنة انتقالية: خطط تشغيلية ربعية دون اشتراط خطة تنفيذية سنوية');

revoke execute on all functions in schema public from anon;
