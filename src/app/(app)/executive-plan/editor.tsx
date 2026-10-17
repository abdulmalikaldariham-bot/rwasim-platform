'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { Button, Input, Label, Select, Textarea } from '@/components/ui';
import { FilePicker } from '@/components/file-picker';
import {
  applyExecImportAction,
  createExecPlanAction,
  deleteExecItemAction,
  parseExecFileAction,
  setExecPlanStatusAction,
  upsertAxisAction,
  upsertGoalAction,
  upsertKpiAction,
} from '@/app/actions/exec';
import type { ParsedExecPlan } from '@/lib/import/executive';
import type { KpiView } from '@/lib/data/kpis';

export function CreateExecPlan({ year }: { year: number }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(`الخطة التنفيذية ${year}م`);
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createExecPlanAction(year, title);
          if (r.ok) router.refresh();
          else toast.error(r.error);
        });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="عنوان الخطة" />
      <Button disabled={pending}>إنشاء</Button>
    </form>
  );
}

export function ExecToolbar({ planId, status }: { planId: string; status: string }) {
  const [pending, start] = useTransition();
  if (status === 'archived') return null;
  return status === 'approved' ? (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => void (await setExecPlanStatusAction(planId, 'draft')).ok)}>
      إعادة إلى مسودة
    </Button>
  ) : (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setExecPlanStatusAction(planId, 'approved');
          r.ok ? toast.success(r.message) : toast.error(r.error);
        })
      }
    >
      اعتماد الخطة التنفيذية
    </Button>
  );
}

function useSave() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        done?.();
        router.refresh();
      } else toast.error(r.error ?? 'تعذر الحفظ');
    });
  return { pending, run };
}

export function AxisEditor({ planId, axis }: { planId: string; axis?: { id: string; title: string } }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(axis?.title ?? '');
  const { pending, run } = useSave();
  return (
    <>
      {axis ? (
        <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(true)} aria-label="تعديل المحور">
          <Pencil size={15} />
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus size={16} /> محور جديد
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={axis ? 'تعديل المحور' : 'محور أو توجه جديد'}>
        <Label htmlFor="axt">العنوان</Label>
        <Input id="axt" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="mt-4 flex justify-between">
          {axis ? (
            <Button variant="ghost" className="text-stalled" onClick={() => confirm('حذف المحور وكل أهدافه ومؤشراته؟') && run(() => deleteExecItemAction('exec_axes', axis.id), () => setOpen(false))}>
              <Trash2 size={15} /> حذف
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={pending || !title.trim()} onClick={() => run(() => upsertAxisAction({ planId, id: axis?.id, title }), () => setOpen(false))}>
            حفظ
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function GoalEditor({ planId, axisId, goal }: { planId: string; axisId: string; goal?: { id: string; title: string; description: string | null } }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [desc, setDesc] = useState(goal?.description ?? '');
  const { pending, run } = useSave();
  return (
    <>
      {goal ? (
        <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(true)} aria-label="تعديل الهدف">
          <Pencil size={15} />
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Plus size={16} /> هدف تنفيذي
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={goal ? 'تعديل الهدف' : 'هدف تنفيذي جديد'}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="gt">الهدف</Label>
            <Input id="gt" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gd" hint="اختياري">الوصف</Label>
            <Textarea id="gd" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-between">
          {goal ? (
            <Button variant="ghost" className="text-stalled" onClick={() => confirm('حذف الهدف ومؤشراته؟') && run(() => deleteExecItemAction('exec_goals', goal.id), () => setOpen(false))}>
              <Trash2 size={15} /> حذف
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={pending || !title.trim()} onClick={() => run(() => upsertGoalAction({ planId, axisId, id: goal?.id, title, description: desc }), () => setOpen(false))}>
            حفظ
          </Button>
        </div>
      </Dialog>
    </>
  );
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function KpiEditor({ planId, goalId, depts, kpi }: { planId: string; goalId: string; depts: { id: string; name: string }[]; kpi?: KpiView }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useSave();
  const [f, setF] = useState({
    code: kpi?.code ?? '',
    name: kpi?.name ?? '',
    definition: kpi?.definition ?? '',
    calc_method: kpi?.calc_method ?? '',
    unit: kpi?.unit ?? '',
    kpi_type: kpi?.kpi_type ?? 'numeric',
    direction: kpi?.direction ?? 'increase',
    baseline: kpi?.baseline?.toString() ?? '',
    annual_target: kpi?.annual_target?.toString() ?? '',
    department_id: kpi?.department_id ?? '',
    frequency: kpi?.frequency ?? 'quarterly',
    data_source: kpi?.data_source ?? '',
    actual_mode: kpi?.actual_mode ?? 'manual',
    q1: kpi?.periodTargets[1]?.toString() ?? '',
    q2: kpi?.periodTargets[2]?.toString() ?? '',
    q3: kpi?.periodTargets[3]?.toString() ?? '',
    q4: kpi?.periodTargets[4]?.toString() ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      {kpi ? (
        <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(true)} aria-label="تعديل المؤشر">
          <Pencil size={15} />
        </Button>
      ) : (
        <Button variant="ghost" className="h-8" onClick={() => setOpen(true)}>
          <Plus size={15} /> مؤشر
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={kpi ? 'تعديل مؤشر الأداء' : 'مؤشر أداء جديد'} wide>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-1">
            <Label htmlFor="kc">الرمز</Label>
            <Input id="kc" value={f.code} onChange={set('code')} />
          </div>
          <div className="sm:col-span-5">
            <Label htmlFor="kn">اسم المؤشر</Label>
            <Input id="kn" value={f.name} onChange={set('name')} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="kd">التعريف</Label>
            <Textarea id="kd" value={f.definition} onChange={set('definition')} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="km">طريقة الاحتساب</Label>
            <Textarea id="km" value={f.calc_method} onChange={set('calc_method')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="kt">النوع</Label>
            <Select id="kt" value={f.kpi_type} onChange={set('kpi_type')}>
              <option value="numeric">عددي</option>
              <option value="percentage">نسبة</option>
              <option value="financial">مالي</option>
              <option value="qualitative">نوعي (درجة 0–100)</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="kdir">اتجاه التحسن</Label>
            <Select id="kdir" value={f.direction} onChange={set('direction')}>
              <option value="increase">الزيادة تحسن</option>
              <option value="decrease">الانخفاض تحسن</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ku">وحدة القياس</Label>
            <Input id="ku" value={f.unit} onChange={set('unit')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="kb" hint="اختياري">خط الأساس</Label>
            <Input id="kb" type="number" step="any" value={f.baseline} onChange={set('baseline')} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ka">المستهدف السنوي</Label>
            <Input id="ka" type="number" step="any" value={f.annual_target} onChange={set('annual_target')} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="kf">دورية القياس</Label>
            <Select id="kf" value={f.frequency} onChange={set('frequency')}>
              <option value="monthly">شهري</option>
              <option value="quarterly">ربعي</option>
              <option value="semiannual">نصف سنوي</option>
              <option value="annual">سنوي</option>
            </Select>
          </div>
          <fieldset className="sm:col-span-6">
            <legend className="mb-1 text-sm font-medium">المستهدفات المرحلية (تراكمية، اختيارية)</legend>
            <div className="grid grid-cols-4 gap-2">
              {(['q1', 'q2', 'q3', 'q4'] as const).map((q, i) => (
                <Input key={q} type="number" step="any" placeholder={`حتى ر${i + 1}`} value={f[q]} onChange={set(q)} dir="ltr" aria-label={`مستهدف الربع ${i + 1}`} />
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-3">
            <Label htmlFor="kdep">الإدارة المسؤولة</Label>
            <Select id="kdep" value={f.department_id} onChange={set('department_id')}>
              <option value="">—</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="kam">مصدر القيمة الفعلية</Label>
            <Select id="kam" value={f.actual_mode} onChange={set('actual_mode')}>
              <option value="manual">إدخال مباشر للقياسات</option>
              <option value="derived_count">مشتقة: عدد الأنشطة المرتبطة المكتملة</option>
            </Select>
          </div>
          <div className="sm:col-span-6">
            <Label htmlFor="ks">مصدر البيانات والشواهد</Label>
            <Input id="ks" value={f.data_source} onChange={set('data_source')} />
          </div>
        </div>
        <div className="mt-5 flex justify-between">
          {kpi ? (
            <Button variant="ghost" className="text-stalled" onClick={() => confirm('حذف المؤشر وقياساته؟') && run(() => deleteExecItemAction('kpis', kpi.id), () => setOpen(false))}>
              <Trash2 size={15} /> حذف
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={pending || !f.name.trim()}
            onClick={() =>
              run(
                () =>
                  upsertKpiAction({
                    id: kpi?.id,
                    planId,
                    goalId,
                    code: f.code,
                    name: f.name,
                    definition: f.definition,
                    calc_method: f.calc_method,
                    unit: f.unit,
                    kpi_type: f.kpi_type,
                    direction: f.direction,
                    baseline: num(f.baseline),
                    annual_target: num(f.annual_target),
                    department_id: f.department_id || null,
                    frequency: f.frequency,
                    data_source: f.data_source,
                    actual_mode: f.actual_mode,
                    targets: { 1: num(f.q1), 2: num(f.q2), 3: num(f.q3), 4: num(f.q4) },
                  }),
                () => setOpen(false),
              )
            }
          >
            حفظ المؤشر
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function ExecImporter({ year }: { year: number }) {
  const [parsed, setParsed] = useState<ParsedExecPlan | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <FilePicker
        busy={pending && !parsed}
        onFile={(file) => {
          const fd = new FormData();
          fd.set('file', file);
          start(async () => {
            const r = await parseExecFileAction(fd);
            if (r.ok) setParsed(r.parsed);
            else toast.error(r.error);
          });
        }}
      />
      {parsed && (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium">
            {parsed.kpis.length} مؤشرًا في {parsed.axes.length} محاور
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {parsed.axes.map((a) => (
              <li key={a.title}>
                <span className="font-medium">{a.title}</span>
                <ul className="ms-4 list-disc text-muted">
                  {a.goals.map((g) => (
                    <li key={g.title}>
                      {g.title} ({g.kpis.length})
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {parsed.issues.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-late">
              {parsed.issues.map((i, k) => (
                <li key={k}>
                  {i.row ? `صف ${i.row}: ` : ''}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-3"
            disabled={pending || !parsed.kpis.length}
            onClick={() =>
              start(async () => {
                const r = await applyExecImportAction(year, parsed);
                if (r.ok) {
                  toast.success(r.message);
                  setParsed(null);
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            استيراد إلى خطة {year}م
          </Button>
        </div>
      )}
    </div>
  );
}
