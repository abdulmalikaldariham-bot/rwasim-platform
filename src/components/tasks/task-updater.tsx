'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Flag, Link2, Paperclip, Target } from 'lucide-react';
import { Dialog } from '../dialog';
import { Button, Input, Label, Textarea } from '../ui';
import { addEvidenceLinkAction, raiseEscalationAction, updateStepAction, uploadEvidenceAction } from '@/app/actions/steps';
import { OUTPUT_REQUIREMENT, STEP_STATUS } from '@/lib/labels';
import { computeStepProgress } from '@/lib/engine/progress';
import { cn, fmtPct } from '@/lib/format';
import type { StepStatus } from '@/lib/engine/types';

export interface UpdatableStep {
  id: string;
  title: string;
  status: StepStatus;
  output: string | null;
  actualOutput?: string | null;
  outputRequirement?: 'none' | 'text' | 'evidence';
  substeps: { id: string; title: string; weight: number; is_done: boolean }[];
  mode?: 'collaborative' | 'individual';
  myStatus?: StepStatus | null;
  myOutput?: string | null;
  isAssignee?: boolean;
}

/**
 * تحديث المهمة: الحالة، المراحل، المخرج المتحقق، الشاهد (ملف أو رابط)، ملاحظة.
 * في المهمة الفردية يسجل المكلف إنجازه هو فقط.
 */
export function TaskUpdater({ step, departmentId, compact, inline }: { step: UpdatableStep; departmentId?: string; compact?: boolean; inline?: boolean }) {
  const individual = step.mode === 'individual';
  const startStatus = (individual ? step.myStatus : step.status) ?? 'not_started';
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [status, setStatus] = useState<StepStatus>(startStatus);
  const [done, setDone] = useState<string[]>(step.substeps.filter((s) => s.is_done).map((s) => s.id));
  const [note, setNote] = useState('');
  const [output, setOutput] = useState((individual ? step.myOutput : step.actualOutput) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [evMode, setEvMode] = useState<'file' | 'link'>('file');
  const [escalate, setEscalate] = useState(false);
  const hasSubs = step.substeps.length > 0 && !individual;
  const req = step.outputRequirement ?? 'text';
  const preview = computeStepProgress(status, step.substeps.map((s) => ({ weight: s.weight, isDone: done.includes(s.id) })));
  const finalStatus: StepStatus = hasSubs && preview >= 100 && status !== 'on_hold' ? 'completed' : status;
  const completing = finalStatus === 'completed' && startStatus !== 'completed';
  const needsOutput = completing && req !== 'none' && !output.trim();
  const needsEvidence = completing && req === 'evidence' && !file && !linkUrl.trim();

  if (individual && !step.isAssignee) {
    return inline ? null : (
      <Link href={`/tasks/${step.id}`} className={cn('rounded-full px-3 text-sm font-semibold text-teal hover:bg-teal-soft', compact ? 'h-8 leading-8 text-xs' : 'h-9 leading-9')}>
        إنجاز المكلفين
      </Link>
    );
  }

  const openWith = (s?: StepStatus) => {
    if (s) setStatus(s);
    setOpen(true);
  };

  const quickComplete = () =>
    start(async () => {
      const r = await updateStepAction({ stepId: step.id, status: 'completed' });
      if (r.ok) {
        toast.success('اكتملت المهمة');
        router.refresh();
      } else toast.error(r.error);
    });

  const save = () =>
    start(async () => {
      // الشاهد أولًا (شرط إغلاق بعض المهام)، ثم تحديث الحالة والمخرج
      if (file) {
        const fd = new FormData();
        fd.set('stepId', step.id);
        fd.set('file', file);
        fd.set('note', note);
        const u = await uploadEvidenceAction(fd);
        if (!u.ok) return void toast.error(u.error);
      }
      if (linkUrl.trim()) {
        const l = await addEvidenceLinkAction({ stepId: step.id, url: linkUrl, note });
        if (!l.ok) return void toast.error(l.error);
      }
      const r = await updateStepAction({ stepId: step.id, status: finalStatus, note, doneSubsteps: hasSubs ? done : null, actualOutput: output });
      if (!r.ok) return void toast.error(r.error);
      if (escalate && departmentId) {
        const e = await raiseEscalationAction({ stepId: step.id, departmentId, kind: 'obstacle', title: `تعثر: ${step.title}`, details: note });
        if (!e.ok) return void toast.error(e.error);
      }
      toast.success(completing ? 'اكتملت المهمة ووُثق مخرجها' : 'تم تحديث المهمة');
      setOpen(false);
      setNote('');
      setFile(null);
      setLinkUrl('');
      setEscalate(false);
      router.refresh();
    });

  const form = (
    <div className="space-y-5">
      {step.output && (
        <div className="rounded-2xl border border-orange/30 bg-orange-soft/60 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-late">
            <Target size={14} /> المخرج المطلوب
          </p>
          <p className="mt-0.5 text-sm text-text">{step.output}</p>
        </div>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{individual ? 'إنجازي في هذه المهمة' : 'حالة التنفيذ'}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['not_started', 'in_progress', 'completed', 'on_hold'] as StepStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              disabled={hasSubs && s === 'completed' && done.length !== step.substeps.length}
              className={cn(
                'h-10 rounded-xl border text-sm transition disabled:opacity-40',
                status === s ? (s === 'completed' ? 'border-done bg-done-soft font-bold text-done' : 'border-teal bg-teal-soft font-bold text-teal') : 'border-line hover:bg-sunken',
              )}
            >
              {STEP_STATUS[s]}
            </button>
          ))}
        </div>
        {!hasSubs && !individual && status === 'in_progress' && <p className="mt-2 text-xs text-muted">المهمة الجارية لا تُحتسب في الإنجاز حتى تكتمل.</p>}
        {individual && <p className="mt-2 text-xs text-muted">هذه مهمة فردية: يسجل كل مكلف إنجازه، وتكتمل المهمة وفق القاعدة المحددة لها.</p>}
      </fieldset>
      {hasSubs && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">المراحل الفرعية</legend>
          <ul className="space-y-1.5">
            {step.substeps.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 hover:bg-sunken">
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
          <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-sm">
            إنجاز المهمة بعد الحفظ: <span className="num font-bold">{fmtPct(preview)}</span>
          </p>
        </fieldset>
      )}
      <div>
        <Label htmlFor={`out-${step.id}`} hint={req === 'none' ? 'اختياري' : completing ? 'مطلوب للإكمال' : 'يُطلب عند الإكمال'}>
          المخرج المتحقق
        </Label>
        <Textarea
          id={`out-${step.id}`}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          placeholder="ما الذي تحقق فعليًا؟ مثال: أُرسلت 4 رسائل توعوية لأولياء الأمور"
          className={needsOutput ? 'border-orange' : undefined}
        />
        <p className="mt-1 text-xs text-muted">شرط الإغلاق لهذه المهمة: {OUTPUT_REQUIREMENT[req]}. إرفاق ملف وحده لا يعني اكتمال المهمة.</p>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-semibold">الشاهد {req === 'evidence' ? <span className="font-normal text-late">(مطلوب للإكمال)</span> : <span className="font-normal text-muted">(اختياري)</span>}</span>
          <div className="flex rounded-full bg-sunken p-0.5 text-xs">
            <button type="button" onClick={() => setEvMode('file')} className={cn('rounded-full px-3 py-1', evMode === 'file' && 'bg-surface font-semibold shadow-card')}>
              ملف
            </button>
            <button type="button" onClick={() => setEvMode('link')} className={cn('rounded-full px-3 py-1', evMode === 'link' && 'bg-surface font-semibold shadow-card')}>
              رابط
            </button>
          </div>
        </div>
        {evMode === 'file' ? (
          <>
            <label htmlFor={`file-${step.id}`} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted hover:bg-sunken', needsEvidence ? 'border-orange' : 'border-line')}>
              <Paperclip size={16} /> {file ? file.name : 'إرفاق ملف أو صورة أو مستند (حتى 25 ميجابايت)'}
            </label>
            <input id={`file-${step.id}`} type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </>
        ) : (
          <div className="relative">
            <Link2 size={16} className="pointer-events-none absolute inset-y-0 right-3 my-auto text-muted" />
            <Input dir="ltr" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" className={cn('pe-9 text-left', needsEvidence && 'border-orange')} aria-label="رابط الشاهد" />
          </div>
        )}
      </div>
      <div>
        <Label htmlFor={`note-${step.id}`} hint="اختيارية">ملاحظة</Label>
        <Textarea id={`note-${step.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ما الذي يعيق التنفيذ؟ أو أي توضيح للمتابعة" className="min-h-16" />
      </div>
      {departmentId && (status === 'on_hold' || note) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--orange)]" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />
          <Flag size={14} className="text-late" /> رفع التعثر للمدير التنفيذي
        </label>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {(needsOutput || needsEvidence) && <p className="me-auto text-xs text-late">{needsOutput ? 'اكتب المخرج المتحقق لإكمال المهمة.' : 'أرفق شاهدًا لإكمال المهمة.'}</p>}
        {!inline && (
          <Button variant="secondary" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
        )}
        <Button onClick={save} disabled={pending || needsOutput || needsEvidence}>
          {pending ? 'جارٍ الحفظ…' : completing ? 'إكمال المهمة' : 'حفظ التحديث'}
        </Button>
      </div>
    </div>
  );

  if (inline) return form;

  const canQuick = !individual && !hasSubs && req === 'none' && step.status !== 'completed';
  return (
    <>
      <div className="flex items-center gap-1.5">
        {startStatus !== 'completed' && (
          <Button
            variant="secondary"
            className={compact ? 'h-8 px-3 text-xs' : 'h-9 px-3'}
            onClick={() => (canQuick ? quickComplete() : openWith('completed'))}
            disabled={pending}
            title="تسجيل اكتمال المهمة"
          >
            <Check size={15} /> {individual ? 'أنجزت' : 'تم الإنجاز'}
          </Button>
        )}
        <Button variant="ghost" className={compact ? 'h-8 px-3 text-xs' : 'h-9 px-3'} onClick={() => openWith()}>
          تحديث
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={step.title} description={individual ? 'سجّل إنجازك ومخرجك في هذه المهمة' : 'حدّث حالة المهمة ووثّق مخرجها'}>
        {form}
      </Dialog>
    </>
  );
}
