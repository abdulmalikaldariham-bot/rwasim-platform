'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarRange, ExternalLink, FileText, Trash2 } from 'lucide-react';
import { assignStepAction, deleteEvidenceAction, evidenceUrlAction, setAssigneeStatusAction, setOutputRequirementAction, setStepDatesAction } from '@/app/actions/steps';
import { Dialog } from '../dialog';
import { Button, Input, Label } from '../ui';
import { OUTPUT_REQUIREMENT, STEP_STATUS } from '@/lib/labels';
import type { StepStatus } from '@/lib/engine/types';

export function AssignSelect({ stepId, value, people }: { stepId: string; value: string | null; people: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="تفويض المهمة"
      disabled={pending}
      defaultValue={value ?? ''}
      className="h-8 max-w-44 rounded-full border border-line bg-surface px-3 text-xs"
      onChange={(e) =>
        start(async () => {
          const r = await assignStepAction(stepId, e.target.value || null);
          r.ok ? toast.success(r.message) : toast.error(r.error);
        })
      }
    >
      <option value="">غير مفوضة</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function EvidenceLink({ path, name, url, id, canDelete }: { path?: string | null; name: string; url?: string | null; id?: string; canDelete?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-1.5">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-teal hover:underline">
          <ExternalLink size={14} /> {name}
        </a>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="inline-flex items-center gap-1 text-sm text-teal hover:underline"
          onClick={() =>
            start(async () => {
              const r = await evidenceUrlAction(path!);
              if (r.url) window.open(r.url, '_blank', 'noopener');
              else toast.error(r.error ?? 'تعذر فتح الملف');
            })
          }
        >
          <FileText size={14} /> {name}
        </button>
      )}
      {canDelete && id && (
        <button
          type="button"
          aria-label="حذف الشاهد"
          className="text-muted hover:text-stalled"
          disabled={pending}
          onClick={() =>
            confirm('حذف هذا الشاهد؟') &&
            start(async () => {
              const r = await deleteEvidenceAction(id);
              if (r.ok) {
                toast.success(r.message);
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          <Trash2 size={13} />
        </button>
      )}
    </span>
  );
}

/** تعديل تاريخ البداية والنهاية (للمخول) */
export function DatesEditor({ stepId, start, end, source }: { stepId: string; start: string | null; end: string | null; source: 'weeks' | 'manual' }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(start ?? '');
  const [e, setE] = useState(end ?? '');
  const [sync, setSync] = useState(true);
  const [reason, setReason] = useState('');
  const [pending, run] = useTransition();
  const router = useRouter();
  const save = (reset = false) =>
    run(async () => {
      const r = await setStepDatesAction({ stepId, start: reset ? null : s || null, end: reset ? null : e || null, syncWeeks: sync, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <button className="inline-flex items-center gap-1 text-sm font-semibold text-teal hover:underline" onClick={() => setOpen(true)}>
        <CalendarRange size={14} /> تعديل
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="فترة تنفيذ المهمة" description="التاريخان يحددان ظهور المهمة في الأسبوع والشهر، واحتساب التأخر">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ds">تاريخ البداية</Label>
              <Input id="ds" type="date" value={s} onChange={(x) => setS(x.target.value)} dir="ltr" />
            </div>
            <div>
              <Label htmlFor="de">تاريخ النهاية</Label>
              <Input id="de" type="date" value={e} min={s || undefined} onChange={(x) => setE(x.target.value)} dir="ltr" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={sync} onChange={(x) => setSync(x.target.checked)} />
            تحديث أسابيع التنفيذ لتطابق الفترة الجديدة
          </label>
          <div>
            <Label htmlFor="dr" hint="اختياري">سبب التعديل</Label>
            <Input id="dr" value={reason} onChange={(x) => setReason(x.target.value)} placeholder="مثال: تأجيل موعد الفعالية" />
          </div>
          <p className="text-xs text-muted">يُسجل التعديل في سجل المهمة وسجل التغييرات. {source === 'manual' ? 'التواريخ الحالية محددة يدويًا.' : 'التواريخ الحالية مستخرجة من الجدولة الأسبوعية.'}</p>
          <div className="flex flex-wrap justify-between gap-2">
            {source === 'manual' ? (
              <Button variant="ghost" disabled={pending} onClick={() => save(true)}>
                إعادتها حسب الجدولة الأسبوعية
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={pending || !s || !e || e < s} onClick={() => save()}>
              حفظ الفترة
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function OutputRequirementSelect({ stepId, value }: { stepId: string; value: 'none' | 'text' | 'evidence' }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      aria-label="شرط توثيق المخرج"
      disabled={pending}
      defaultValue={value}
      className="h-8 rounded-full border border-line bg-surface px-3 text-xs"
      onChange={(e) =>
        start(async () => {
          const r = await setOutputRequirementAction(stepId, e.target.value as 'none');
          if (r.ok) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {Object.entries(OUTPUT_REQUIREMENT).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** تحديث حالة مكلف في مهمة فردية (للمسؤول) */
export function AssigneeStatusSelect({ stepId, userId, value, disabled }: { stepId: string; userId: string; value: StepStatus; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      aria-label="حالة المكلف"
      disabled={pending || disabled}
      value={value}
      className="h-8 rounded-full border border-line bg-surface px-2.5 text-xs"
      onChange={(e) =>
        start(async () => {
          const r = await setAssigneeStatusAction({ stepId, userId, status: e.target.value, output: e.target.value === 'completed' ? prompt('المخرج المتحقق لهذا المكلف') ?? '' : undefined });
          if (r.ok) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {(['not_started', 'in_progress', 'completed', 'on_hold'] as StepStatus[]).map((s) => (
        <option key={s} value={s}>
          {STEP_STATUS[s]}
        </option>
      ))}
    </select>
  );
}
