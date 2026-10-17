'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, ButtonLink, Input, Label, Panel, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import {
  addActivityAction,
  approvePlanAction,
  decideChangeAction,
  deleteActivityAction,
  deletePlanAction,
  deleteStepAction,
  returnPlanAction,
  submitPlanAction,
  updateActivityAction,
  upsertStepAction,
} from '@/app/actions/plans';
import { KIND_LABELS } from '@/lib/engine/weights';
import { MONTHS } from '@/lib/labels';
import { cn, fmtPct } from '@/lib/format';

type R = { ok: boolean; error?: string; message?: string };

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error ?? 'تعذر التنفيذ');
    });
  return { pending, run, router };
}

export function PlanActions({
  planId,
  status,
  isEd,
  canEdit,
  hasIssues,
  hasPendingRequest,
}: {
  planId: string;
  status: string;
  isEd: boolean;
  canEdit: boolean;
  hasIssues: boolean;
  hasPendingRequest: boolean;
}) {
  const { pending, run, router } = useRun();
  const [returnOpen, setReturnOpen] = useState(false);
  const [note, setNote] = useState('');
  const draft = status === 'draft' || status === 'returned';
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && draft && (
        <>
          <ButtonLink variant="secondary" href={`/plans/${planId}/weights`}>
            ضبط الأوزان
          </ButtonLink>
          {status === 'draft' && (
            <Button variant="ghost" className="text-stalled" disabled={pending} onClick={() => confirm('حذف هذه المسودة نهائيًا؟') && run(() => deletePlanAction(planId), () => router.push('/plans'))}>
              حذف المسودة
            </Button>
          )}
          {!isEd && (
            <Button disabled={pending || hasIssues} onClick={() => run(() => submitPlanAction(planId))} title={hasIssues ? 'أكمل الأوزان أولًا' : undefined}>
              رفع للاعتماد
            </Button>
          )}
        </>
      )}
      {isEd && (draft || status === 'submitted') && (
        <>
          {status === 'submitted' && (
            <Button variant="secondary" onClick={() => setReturnOpen(true)}>
              إعادة للتعديل
            </Button>
          )}
          <Button disabled={pending || hasIssues} onClick={() => run(() => approvePlanAction(planId))}>
            اعتماد الخطة
          </Button>
        </>
      )}
      {canEdit && status === 'approved' && (
        <ButtonLink variant="secondary" href={`/plans/${planId}/weights`}>
          {isEd ? 'تعديل الأوزان (يُوثق كإصدار جديد)' : hasPendingRequest ? 'طلب تعديل آخر' : 'طلب تعديل الأوزان'}
        </ButtonLink>
      )}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen} title="إعادة الخطة للتعديل">
        <Label htmlFor="rn">ما المطلوب تعديله؟</Label>
        <Textarea id="rn" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button className="mt-3" disabled={pending} onClick={() => run(() => returnPlanAction(planId, note), () => setReturnOpen(false))}>
          إعادة الخطة
        </Button>
      </Dialog>
    </div>
  );
}

export function ChangeRequestActions({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <div className="mt-2 flex gap-2">
      <Button className="h-8 px-3 text-xs" disabled={pending} onClick={() => run(() => decideChangeAction(id, true))}>
        اعتماد التعديل
      </Button>
      <Button variant="secondary" className="h-8 px-3 text-xs" disabled={pending} onClick={() => run(() => decideChangeAction(id, false, prompt('سبب الرفض') ?? undefined))}>
        رفض
      </Button>
    </div>
  );
}

type Step = { id: string; title: string; responsible_text: string | null; output: string | null; weeks: number[]; weight: number; is_core: boolean; import_followup: string | null };
type Act = { id: string; title: string; kind: string; kpi_id: string | null; weight: number; steps: Step[] };

export function StructureEditor({ planId, activities, months, kpis }: { planId: string; activities: Act[]; months: number[]; kpis: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [newAct, setNewAct] = useState('');
  return (
    <div className="space-y-4">
      {activities.map((a) => (
        <Panel key={a.id}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
            <ActivityHeader a={a} kpis={kpis} />
            <div className="flex gap-1">
              <StepDialog planId={planId} activityId={a.id} months={months} />
              <Button variant="ghost" className="h-8 px-2 text-stalled" aria-label="حذف النشاط" onClick={() => confirm(`حذف النشاط «${a.title}» وخطواته؟`) && run(() => deleteActivityAction(a.id))}>
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {a.steps.length === 0 && <li className="px-5 py-3 text-sm text-late">النشاط بلا خطوات — أضف خطوة واحدة على الأقل.</li>}
            {a.steps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p>
                    {s.title}
                    {s.is_core && <span className="ms-2 text-xs text-late">الجوهرية</span>}
                  </p>
                  <p className={cn('text-xs', s.responsible_text && s.output ? 'text-muted' : 'text-late')}>
                    {s.responsible_text ?? 'بلا مسؤول'} — {s.output ?? 'بلا مخرج'}
                  </p>
                </div>
                <WeekStrip weeks={s.weeks} />
                <span className="num w-12 text-left text-xs text-muted">{fmtPct(s.weight)}</span>
                <div className="flex gap-1">
                  <StepDialog planId={planId} activityId={a.id} months={months} step={s} />
                  <Button variant="ghost" className="h-8 px-2 text-stalled" aria-label="حذف الخطوة" disabled={pending} onClick={() => confirm('حذف الخطوة؟') && run(() => deleteStepAction(s.id))}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newAct.trim()) run(() => addActivityAction(planId, newAct.trim()), () => setNewAct(''));
        }}
      >
        <Input value={newAct} onChange={(e) => setNewAct(e.target.value)} placeholder="اسم نشاط أو برنامج جديد" aria-label="نشاط جديد" />
        <Button disabled={pending || !newAct.trim()}>
          <Plus size={16} /> إضافة نشاط
        </Button>
      </form>
    </div>
  );
}

function ActivityHeader({ a, kpis }: { a: Act; kpis: { id: string; name: string }[] }) {
  const { run } = useRun();
  const [title, setTitle] = useState(a.title);
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <input
        className="w-full rounded-md border border-transparent bg-transparent px-1 text-base font-semibold text-ink hover:border-line focus:border-teal focus:outline-none"
        value={title}
        aria-label="اسم النشاط"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== a.title && run(() => updateActivityAction(a.id, { title: title.trim() }))}
      />
      <div className="flex flex-wrap gap-2">
        <select className="h-8 rounded-md border border-line bg-surface px-2 text-xs" value={a.kind} aria-label="طبيعة النشاط" onChange={(e) => run(() => updateActivityAction(a.id, { kind: e.target.value }))}>
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className="h-8 max-w-64 rounded-md border border-line bg-surface px-2 text-xs" value={a.kpi_id ?? ''} aria-label="المؤشر التنفيذي المرتبط" onChange={(e) => run(() => updateActivityAction(a.id, { kpi_id: e.target.value || null }))}>
          <option value="">بلا مؤشر تنفيذي مرتبط</option>
          {kpis.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-muted">الوزن {fmtPct(a.weight)}</span>
      </div>
    </div>
  );
}

function WeekStrip({ weeks }: { weeks: number[] }) {
  return (
    <span className="flex gap-0.5" aria-label={`أسابيع: ${weeks.join('، ') || 'بلا جدولة'}`}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
        <span key={w} className={cn('h-2.5 w-2.5 rounded-sm', w % 4 === 1 && w > 1 && 'ms-1', weeks.includes(w) ? 'bg-teal' : 'bg-sunken')} />
      ))}
    </span>
  );
}

function StepDialog({ planId, activityId, months, step }: { planId: string; activityId: string; months: number[]; step?: Step }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const [f, setF] = useState({ title: step?.title ?? '', responsible: step?.responsible_text ?? '', output: step?.output ?? '', weeks: step?.weeks ?? [] });
  return (
    <>
      {step ? (
        <Button variant="ghost" className="h-8 px-2" aria-label="تعديل الخطوة" onClick={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      ) : (
        <Button variant="ghost" className="h-8" onClick={() => setOpen(true)}>
          <Plus size={15} /> خطوة
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={step ? 'تعديل الخطوة' : 'خطوة جديدة'}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="st">الخطوة</Label>
            <Input id="st" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sr">المسؤول</Label>
              <Input id="sr" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="so">المخرج</Label>
              <Input id="so" value={f.output} onChange={(e) => setF({ ...f, output: e.target.value })} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">أسابيع التنفيذ</legend>
            <div className="grid grid-cols-3 gap-2">
              {months.map((m, mi) => (
                <div key={m}>
                  <p className="mb-1 text-xs text-muted">{MONTHS[m]}</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((wom) => {
                      const w = mi * 4 + wom;
                      const on = f.weeks.includes(w);
                      return (
                        <button
                          key={w}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setF({ ...f, weeks: on ? f.weeks.filter((x) => x !== w) : [...f.weeks, w].sort((x, y) => x - y) })}
                          className={cn('h-8 flex-1 rounded-md text-xs', on ? 'bg-teal text-white' : 'bg-sunken text-muted')}
                        >
                          س{wom}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {step?.import_followup && <p className="text-xs text-muted">المتابعة في ملف Excel: «{step.import_followup}» (للمراجعة فقط)</p>}
          <Button
            className="w-full"
            disabled={pending || !f.title.trim()}
            onClick={() =>
              run(
                () => upsertStepAction({ id: step?.id, activityId, planId, title: f.title.trim(), responsible_text: f.responsible.trim() || null, output: f.output.trim() || null, weeks: f.weeks }),
                () => {
                  setOpen(false);
                  if (!step) setF({ title: '', responsible: '', output: '', weeks: [] });
                },
              )
            }
          >
            حفظ
          </Button>
        </div>
      </Dialog>
    </>
  );
}

