-- =====================================================================
-- رواسم | منصة الأداء المؤسسي — المخطط الأساسي لقاعدة البيانات
-- =====================================================================
-- ملاحظات تصميمية:
--  * كل الجداول في public محمية بـ RLS (انظر ملف rls).
--  * الأوزان تخزن كنسب مئوية (0..100) بدقة 3 خانات عشرية.
--  * الإنجاز يحتسب في التطبيق (src/lib/engine) من حقائق رقمية تعيدها
--    الدالة get_progress_facts، أما حالة الخطوة ونسبتها فتحدث فقط عبر
--    الدالة update_step_progress حتى يُسجل كل تحديث.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- الأنواع ----------
create type public.app_role as enum ('executive_director','dept_manager','employee','board_member','system_admin');
create type public.plan_status as enum ('draft','submitted','returned','approved','archived');
create type public.step_status as enum ('not_started','in_progress','completed','on_hold');
create type public.kpi_type as enum ('numeric','percentage','financial','qualitative');
create type public.kpi_direction as enum ('increase','decrease');
create type public.measure_frequency as enum ('monthly','quarterly','semiannual','annual');
create type public.year_status as enum ('planning','active','archived');
create type public.report_type as enum ('monthly','quarterly','annual');
create type public.report_status as enum ('draft','approved');
create type public.directive_status as enum ('open','in_progress','closed');
create type public.request_status as enum ('pending','approved','rejected');
create type public.activity_kind as enum ('project','planning','construction','recurring','admin','other');

-- ---------- الإدارات ----------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text,
  code text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- ---------- المستخدمون ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.app_role not null default 'employee',
  department_id uuid references public.departments(id),
  job_title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles(department_id);

-- ---------- السنوات وحدود الأسابيع ----------
create table public.years (
  year int primary key check (year between 2020 and 2100),
  status public.year_status not null default 'planning',
  is_transitional boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id)
);

-- كل ربع = 3 أشهر × 4 أسابيع (س1..س4) = 12 أسبوعًا، بحدود قابلة للمراجعة
create table public.quarter_weeks (
  year int not null references public.years(year) on delete cascade,
  quarter smallint not null check (quarter between 1 and 4),
  week_index smallint not null check (week_index between 1 and 12),
  month smallint not null check (month between 1 and 12),
  week_of_month smallint not null check (week_of_month between 1 and 4),
  start_date date not null,
  end_date date not null,
  is_reviewed boolean not null default false,
  primary key (year, quarter, week_index),
  check (end_date >= start_date)
);

-- ---------- أوزان الإدارات (بإصدارات) ----------
create table public.dept_weight_sets (
  id uuid primary key default gen_random_uuid(),
  year int not null references public.years(year),
  version int not null,
  status public.request_status not null default 'pending',
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  unique (year, version)
);
create table public.dept_weight_items (
  set_id uuid not null references public.dept_weight_sets(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  weight numeric(7,3) not null check (weight >= 0 and weight <= 100),
  primary key (set_id, department_id)
);

-- ---------- الخطة التنفيذية السنوية ----------
create table public.exec_plans (
  id uuid primary key default gen_random_uuid(),
  year int not null unique references public.years(year),
  title text not null,
  status public.plan_status not null default 'draft',
  version int not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.exec_axes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.exec_plans(id) on delete cascade,
  title text not null,
  sort_order int not null default 0
);
create table public.exec_goals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.exec_plans(id) on delete cascade,
  axis_id uuid references public.exec_axes(id) on delete cascade,
  title text not null,
  description text,
  sort_order int not null default 0
);
create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.exec_plans(id) on delete cascade,
  goal_id uuid references public.exec_goals(id) on delete set null,
  code text,
  name text not null,
  definition text,
  calc_method text,
  unit text,
  kpi_type public.kpi_type not null default 'numeric',
  direction public.kpi_direction not null default 'increase',
  baseline numeric,
  annual_target numeric,
  department_id uuid references public.departments(id),
  frequency public.measure_frequency not null default 'quarterly',
  data_source text,
  actual_mode text not null default 'manual' check (actual_mode in ('manual','derived_count')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- المستهدفات المرحلية (تراكمية حتى نهاية الربع)
create table public.kpi_period_targets (
  kpi_id uuid not null references public.kpis(id) on delete cascade,
  quarter smallint not null check (quarter between 1 and 4),
  target numeric not null,
  primary key (kpi_id, quarter)
);
-- القياسات الفعلية (قيمة تراكمية حتى تاريخ القياس)
create table public.kpi_measurements (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpis(id) on delete cascade,
  measured_on date not null default current_date,
  quarter smallint check (quarter between 1 and 4),
  value numeric not null,
  note text,
  evidence_path text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create index on public.kpi_measurements(kpi_id, measured_on desc);

-- ---------- الخطط التشغيلية الربعية ----------
create table public.op_plans (
  id uuid primary key default gen_random_uuid(),
  year int not null references public.years(year),
  quarter smallint not null check (quarter between 1 and 4),
  department_id uuid not null references public.departments(id),
  title text,
  status public.plan_status not null default 'draft',
  version int not null default 1,
  return_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (year, quarter, department_id)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  seq int not null default 0,
  title text not null,
  description text,
  kind public.activity_kind not null default 'other',
  kpi_id uuid references public.kpis(id) on delete set null,
  weight numeric(7,3) not null default 0 check (weight >= 0 and weight <= 100),
  suggested_weight numeric(7,3),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.activities(plan_id);

create table public.steps (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  seq int not null default 0,
  title text not null,
  responsible_text text,
  assignee_id uuid references public.profiles(id) on delete set null,
  output text,
  weight numeric(7,3) not null default 0 check (weight >= 0 and weight <= 100),
  suggested_weight numeric(7,3),
  is_core boolean not null default false,
  status public.step_status not null default 'not_started',
  progress numeric(6,2) not null default 0 check (progress >= 0 and progress <= 100),
  actual_start date,
  actual_end date,
  import_followup text,      -- نص عمود «المتابعة» كما ورد في Excel (للمراجعة فقط، لا يحتسب)
  import_note text,
  is_archived boolean not null default false,
  last_update_at timestamptz,
  last_update_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.steps(activity_id);
create index on public.steps(plan_id);
create index on public.steps(assignee_id);

-- جدولة الخطوة: سجل واحد للخطوة، وعدة أسابيع مرتبطة بها
create table public.step_weeks (
  step_id uuid not null references public.steps(id) on delete cascade,
  week_index smallint not null check (week_index between 1 and 12),
  intensity smallint,            -- القيمة الرقمية الواردة في الخلية إن وجدت (مثل 4 رسائل)
  primary key (step_id, week_index)
);

-- مراحل فرعية / دورات عمل داخل الخطوة (مجموع أوزانها = 100% من وزن الخطوة)
create table public.substeps (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.steps(id) on delete cascade,
  title text not null,
  weight numeric(7,3) not null default 0 check (weight >= 0 and weight <= 100),
  sort_order int not null default 0,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles(id)
);
create index on public.substeps(step_id);

-- سجل التحديثات التشغيلية
create table public.step_updates (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.steps(id) on delete cascade,
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  user_id uuid references public.profiles(id),
  from_status public.step_status,
  to_status public.step_status,
  from_progress numeric(6,2),
  to_progress numeric(6,2),
  note text,
  created_at timestamptz not null default now()
);
create index on public.step_updates(plan_id, created_at desc);
create index on public.step_updates(step_id, created_at desc);

-- الشواهد
create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.steps(id) on delete cascade,
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  note text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.evidence(step_id);

-- لقطات الأوزان المعتمدة لكل إصدار من الخطة
create table public.plan_weight_snapshots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz not null default now(),
  reason text,
  unique (plan_id, version)
);

-- طلبات التعديل على الخطط المعتمدة (أوزان/جدولة/هيكل)
create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.op_plans(id) on delete cascade,
  kind text not null check (kind in ('weights','structure','schedule')),
  payload jsonb not null,
  reason text,
  status public.request_status not null default 'pending',
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text
);

-- ---------- الاستيراد ----------
create table public.plan_imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('operational','executive')),
  year int not null,
  quarter smallint,
  file_name text,
  storage_path text,
  parsed jsonb,
  issues jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_plan_ids uuid[]
);

-- ---------- مركز المتابعة التنفيذية ----------
create table public.directives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  target_type text not null default 'general' check (target_type in ('general','department','activity','kpi')),
  department_id uuid references public.departments(id),
  activity_id uuid references public.activities(id) on delete set null,
  kpi_id uuid references public.kpis(id) on delete set null,
  assignee_id uuid references public.profiles(id),
  due_date date,
  status public.directive_status not null default 'open',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create table public.directive_updates (
  id uuid primary key default gen_random_uuid(),
  directive_id uuid not null references public.directives(id) on delete cascade,
  user_id uuid references public.profiles(id),
  status public.directive_status,
  note text,
  created_at timestamptz not null default now()
);

-- طلبات التدخل / القرارات المطلوبة التي ترفعها الإدارات
create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'decision' check (kind in ('decision','guidance','obstacle')),
  department_id uuid references public.departments(id),
  activity_id uuid references public.activities(id) on delete cascade,
  step_id uuid references public.steps(id) on delete cascade,
  title text not null,
  details text,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  raised_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);

-- ---------- التقارير ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  type public.report_type not null,
  year int not null,
  quarter smallint,
  month smallint,
  department_id uuid references public.departments(id),
  title text not null,
  snapshot jsonb not null,
  status public.report_status not null default 'draft',
  director_comment text,
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz
);
create index on public.reports(year, type);

-- ---------- السجل والإعدادات ----------
create table public.audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  at timestamptz not null default now()
);
create index on public.audit_log(table_name, record_id);
create index on public.audit_log(at desc);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
