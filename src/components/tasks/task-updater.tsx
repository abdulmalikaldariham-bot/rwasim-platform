'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Paperclip, Flag } from 'lucide-react';
import { Dialog } from '../dialog';
import { Button, Textarea, Label } from '../ui';
import { updateStepAction, uploadEvidenceAction, raiseEscalationAction } from '@/app/actions/steps';
import { STEP_STATUS } from '@/lib/labels';
import { computeStepProgress } from '@/lib/engine/progress';
import { fmtPct } from '@/lib/format';
import type { StepStatus } from '@/lib/engine/types';

export interface UpdatableStep {
  id: string;
  title: string;
  status: StepStatus;
  output: string | null;
  substeps: { id: string; title: string; weight: number; is_done: boolean }[];
}

/** زر واحد للإكمال السريع + نافذة تحديث كاملة (حالة، مراحل، ملاحظة، شاهد) */
export function TaskUpdater({ step, departmentId, compact }: { step: UpdatableStep; departmentId?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<StepStatus>(step.status);
  const [done, setDone] = useState<string[]>(step.substeps.filter((s) => s.is_done).map((s) => s.id));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [escalate, setEscalate] = useState(false);
  const hasSubs = step.substeps.length > 0;
  const preview = computeStepProgress(status, step.substeps.map((s) => ({ weight: s.weight, isDone: done.includes(s.id) })));

  const quickComplete = () =>
    start(async () => {
      const r = await updateStepAction({ stepId: step.id, status: 'completed', doneSubsteps: hasSubs ? step.substeps.map((s) => s.id) : null });
      r.ok ? toast.success('اكتملت المهمة') : toast.error(r.error);
    });

  const save = () =>
    start(async () => {
      const finalStatus: StepStatus = hasSubs && preview >= 100 && status !== 'on_hold' ? 'completed' : status;
      const r = await updateStepAction({ stepId: step.id, status: finalStatus, note, doneSubsteps: hasSubs ? done : null });
      if (!r.ok) return void toast.error(r.error);
      if (file) {
        const fd = new FormData();
        fd.set('stepId', step.id);
        fd.set('file', file);
        fd.set('note', note);
        const u = await uploadEvidenceAction(fd);
        if (!u.ok) return void toast.error(u.error);
      }
      if (escalate && departmentId) {
        const e = await raiseEscalationAction({ stepId: step.id, departmentId, kind: 'obstacle', title: `تعثر: ${step.title}`, details: note });
        if (!e.ok) return void toast.error(e.error);
      }
      toast.success('تم تحديث المهمة');
      setOpen(false);
      setNote('');
      setFile(null);
      setEscalate(false);
    });

  return (
    <>
      <div className="flex items-center gap-1.5">
        {step.status !== 'completed' && !hasSubs && (
          <Button variant="secondary" className={compact ? 'h-8 px-2.5 text-xs' : 'h-9 px-3'} onClick={quickComplete} disabled={pending} title="تسجيل اكتمال المهمة">
            <Check size={15} /> تم الإنجاز
          </Button>
        )}
        <Button variant="ghost" className={compact ? 'h-8 px-2.5 text-xs' : 'h-9 px-3'} onClick={() => setOpen(true)}>
          تحديث
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={step.title} description={step.output ? `المخرج المطلوب: ${step.output}` : undefined}>
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">الحالة</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['not_started', 'in_progress', 'completed', 'on_hold'] as StepStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                  disabled={hasSubs && s === 'completed' && done.length !== step.substeps.length}
                  className={`h-10 rounded-lg border text-sm disabled:opacity-40 ${status === s ? 'border-teal bg-teal-soft font-semibold text-teal' : 'border-line hover:bg-sunken'}`}
                >
                  {STEP_STATUS[s]}
                </button>
              ))}
            </div>
            {!hasSubs && status === 'in_progress' && <p className="mt-2 text-xs text-muted">المهمة الجارية لا تُحتسب في الإنجاز حتى تكتمل.</p>}
          </fieldset>
          {hasSubs && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">المراحل الفرعية</legend>
              <ul className="space-y-1.5">
                {step.substeps.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 hover:bg-sunken">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--teal)]"
                          checked={done.includes(s.id)}
                          onChange={(e) => {
                            setDone((d) => (e.target.checked ? [...d, s.id] : d.filter((x) => x !== s.id)));
                            if (status === 'not_started' && e.target.checked) setStatus('in_progress');
                          }}
                        />
                        {s.title}
                      </span>
                      <span className="num text-xs text-muted">{fmtPct(s.weight)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
            إنجاز المهمة بعد الحفظ: <span className="num font-bold">{fmtPct(preview)}</span>
          </p>
          <div>
            <Label htmlFor={`note-${step.id}`} hint="اختيارية">ملاحظة</Label>
            <Textarea id={`note-${step.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ما الذي أنجز؟ أو ما الذي يعيق التنفيذ؟" />
          </div>
          <div>
            <Label htmlFor={`file-${step.id}`} hint="اختياري">الشاهد</Label>
            <label htmlFor={`file-${step.id}`} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted hover:bg-sunken">
              <Paperclip size={16} /> {file ? file.name : 'إرفاق ملف (صورة، PDF، مستند)'}
            </label>
            <input id={`file-${step.id}`} type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {departmentId && (status === 'on_hold' || note) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--orange)]" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />
              <Flag size={14} className="text-late" /> رفع التعثر للمدير التنفيذي
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? 'جارٍ الحفظ…' : 'حفظ التحديث'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
