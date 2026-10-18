'use client';
// =====================================================================
// إدارة الأوزان — شاشة واحدة بمستويين:
//   1) بطاقات المشاريع والأنشطة: وزن مباشر، عدد المهام، حالة الاكتمال، شريط المجموع
//   2) مهام النشاط المختار: الوزن، المهمة الجوهرية، المخرج المطلوب، المراحل الفرعية
// القاعدة: الجوهرية 40٪ والباقي 60٪، ومجموع كل مستوى 100٪، ولا يُحفظ توزيع ناقص.
// =====================================================================
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Pencil, Plus, Scissors, Sparkles, Star, Trash2, X } from 'lucide-react';
import { Button, Input, Notice, Panel, Textarea } from '@/components/ui';
import {
  saveWeightsAction,
  submitPlanAction,
  approvePlanAction,
  requestChangeAction,
  directChangeAction,
  setRequiredOutputAction,
} from '@/app/actions/plans';
import {
  CORE_STEP_WEIGHT,
  KIND_LABELS,
  distribute,
  suggestActivityWeightsByNature,
  suggestActivityWeightsEqual,
  suggestCycleSubsteps,
  suggestStepWeights,
} from '@/lib/engine/weights';
import { round2 } from '@/lib/engine/progress';
import type { ActivityKind } from '@/lib/engine/types';
import { cn, fmtPct } from '@/lib/format';

type Sub = { title: string; weight: number };
type S = { id: string; title: string; weight: number; suggested: number | null; is_core: boolean; responsible: string | null; output: string | null; weeks: number[]; substeps: Sub[] };
type A = { id: string; title: string; kind: ActivityKind; weight: number; suggested: number | null; steps: S[] };

const SEG = ['#336e7c', '#f09223', '#0e4156', '#7bb8ab', '#b46a12', '#4f8f9e', '#082633', '#e7b26b', '#2a6070', '#9cc9d2'];
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + (Number(x) || 0), 0));
const ok100 = (n: number) => Math.abs(n - 100) <= 0.01;

export function WeightsEditor({ planId, quarter, mode, isEd, activities: initial }: { planId: string; quarter: number; mode: 'draft' | 'request' | 'direct'; isEd: boolean; activities: A[] }) {
  const [acts, setActs] = useState<A[]>(initial);
  const [openAct, setOpenAct] = useState<string | null>(initial[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const locked = mode !== 'draft';
  const detailRef = useRef<HTMLDivElement>(null);
  const sig = (xs: A[]) => JSON.stringify(xs.map((a) => [a.weight, a.steps.map((x) => [x.weight, x.is_core, x.substeps])]));
  const dirty = sig(acts) !== sig(initial);

  // تحذير قبل مغادرة الصفحة بتعديلات غير محفوظة
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const total = sum(acts.map((a) => a.weight));
  const stepTotals = Object.fromEntries(acts.map((a) => [a.id, sum(a.steps.map((s) => s.weight))]));
  const problems = useMemo(() => {
    const p: { id?: string; text: string }[] = [];
    if (!ok100(total)) p.push({ text: total > 100 ? `أوزان المشاريع والأنشطة تزيد ${fmtPct(round2(total - 100))} عن 100٪` : `أوزان المشاريع والأنشطة ينقصها ${fmtPct(round2(100 - total))}` });
    for (const a of acts) {
      if (!a.steps.length) p.push({ id: a.id, text: `«${a.title}» بلا مهام` });
      else if (!ok100(stepTotals[a.id])) p.push({ id: a.id, text: `مهام «${a.title}» مجموعها ${fmtPct(stepTotals[a.id])}` });
      for (const s of a.steps) if (s.substeps.length && !ok100(sum(s.substeps.map((x) => x.weight)))) p.push({ id: a.id, text: `مراحل «${s.title}» مجموعها ${fmtPct(sum(s.substeps.map((x) => x.weight)))}` });
      if (a.steps.some((s) => s.weight < 0 || s.weight > 100)) p.push({ id: a.id, text: `وزن غير صالح في «${a.title}»` });
    }
    return p;
  }, [acts, total, stepTotals]);
  const ready = problems.length === 0;

  const setAct = (id: string, patch: Partial<A>) => setActs((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const setStep = (aid: string, sid: string, patch: Partial<S>) =>
    setActs((xs) => xs.map((a) => (a.id !== aid ? a : { ...a, steps: a.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) })));

  const choose = (id: string) => {
    setOpenAct(id);
    if (window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const payload = () => ({
    planId,
    activities: acts.map((a) => ({ id: a.id, weight: round2(a.weight) })),
    steps: acts.flatMap((a) => a.steps.map((s) => ({ id: s.id, weight: round2(s.weight), is_core: s.is_core }))),
    substeps: locked ? undefined : acts.flatMap((a) => a.steps.map((s) => ({ stepId: s.id, items: s.substeps }))),
  });

  const save = (then?: 'submit' | 'approve') =>
    start(async () => {
      if (!ready) return void toast.error('أكمل التوزيع أولًا: ' + problems[0].text);
      if (locked) {
        if (!reason.trim()) return void toast.error('اكتب سبب التعديل');
        const p = payload();
        const body = { activities: p.activities, steps: p.steps.map(({ id, weight }) => ({ id, weight })) };
        const r = mode === 'direct' ? await directChangeAction(planId, 'weights', body, reason) : await requestChangeAction(planId, 'weights', body, reason);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message);
        router.push(`/plans/${planId}`);
        return;
      }
      const r = await saveWeightsAction(payload());
      if (!r.ok) return void toast.error(r.error);
      if (then) {
        const s = then === 'submit' ? await submitPlanAction(planId) : await approvePlanAction(planId);
        if (!s.ok) return void toast.error(s.error);
        toast.success(s.message);
        return void router.push(`/plans/${planId}`);
      }
      toast.success('حُفظت الأوزان');
      router.refresh();
    });

  const current = acts.find((a) => a.id === openAct) ?? null;
  const currentIndex = acts.findIndex((a) => a.id === openAct);

  return (
    <div className="space-y-5">
      {locked && (
        <Notice tone="late" title="الخطة معتمدة">
          {mode === 'direct'
            ? 'التعديل يُطبق كإصدار جديد من الأوزان ويُسجل في سجل التغييرات، ولا تتغير التقارير المعتمدة السابقة.'
            : 'التعديل يُرسل طلبًا إلى المدير التنفيذي ويُطبق بعد موافقته كإصدار جديد. المراحل الفرعية لا تُعدل بعد الاعتماد.'}
        </Notice>
      )}

      {/* شريط المجموع والإجراءات — ثابت أعلى الشاشة */}
      <Panel className="z-20 p-4 sm:p-5 lg:sticky lg:top-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-sm font-semibold text-ink sm:text-base">مجموع أوزان المشاريع والأنشطة</h2>
              <span className={cn('num text-2xl font-bold', ok100(total) ? 'text-done' : 'text-late')}>{fmtPct(total)}</span>
              <span className="text-sm text-muted">{ok100(total) ? 'مكتمل' : total > 100 ? `زيادة ${fmtPct(round2(total - 100))}` : `متبقٍ ${fmtPct(round2(100 - total))}`}</span>
            </div>
            <div className="relative flex h-3 overflow-hidden rounded-full bg-sunken" role="img" aria-label="توزيع أوزان الأنشطة">
              {acts.map((a, i) =>
                a.weight > 0 ? (
                  <button
                    key={a.id}
                    onClick={() => choose(a.id)}
                    className="h-full border-l border-white/70 transition-[width] duration-300 dark:border-black/40"
                    style={{ width: `${Math.min(100, (a.weight / Math.max(100, total)) * 100)}%`, background: SEG[i % SEG.length] }}
                    title={`${a.title}: ${fmtPct(a.weight)}`}
                    aria-label={`${a.title}: ${fmtPct(a.weight)}`}
                  />
                ) : null,
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="h-9" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsEqual(xs.length)[i] })))}>
              توزيع متساوٍ
            </Button>
            <Button variant="ghost" className="h-9" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsByNature(xs.map((x) => ({ kind: x.kind, steps: x.steps })))[i] })))}>
              <Sparkles size={15} /> توزيع مقترح
            </Button>
            {!locked && (
              <>
                <Button variant="secondary" className="h-9" disabled={pending || !ready || !dirty} onClick={() => save()}>
                  حفظ
                </Button>
                <Button className="h-9" disabled={pending || !ready} onClick={() => save(isEd ? 'approve' : 'submit')}>
                  {isEd ? 'حفظ واعتماد الخطة' : 'حفظ ورفع للاعتماد'}
                </Button>
              </>
            )}
          </div>
        </div>
        {problems.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-orange-soft px-3 py-2 text-sm text-late" role="status">
            <CircleAlert size={16} className="shrink-0" />
            <span className="font-medium">لا يمكن الحفظ قبل إكمال التوزيع:</span>
            {problems.slice(0, 4).map((p, i) => (
              <button key={i} className="rounded-full bg-surface/70 px-2 py-0.5 text-xs hover:underline" onClick={() => p.id && choose(p.id)}>
                {p.text}
              </button>
            ))}
            {problems.length > 4 && <span className="text-xs">و{problems.length - 4} أخرى</span>}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        {/* المستوى الأول: البطاقات */}
        <section aria-label="المشاريع والأنشطة" className="space-y-2.5">
          {acts.map((a, i) => {
            const st = stepTotals[a.id];
            const good = a.steps.length > 0 && ok100(st);
            const sel = a.id === openAct;
            return (
              <div
                key={a.id}
                className={cn('relative overflow-hidden rounded-2xl border bg-surface p-4 shadow-[var(--shadow)] transition', sel ? 'border-teal ring-2 ring-teal/20' : 'border-line hover:border-teal/50')}
              >
                <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: SEG[i % SEG.length] }} aria-hidden />
                <div className="flex items-start gap-3">
                  <button className="min-w-0 flex-1 text-start" onClick={() => choose(a.id)} aria-expanded={sel}>
                    <p className="font-semibold leading-snug text-ink">{a.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className={cn('rounded-full px-2 py-0.5', a.kind === 'project' ? 'bg-orange-soft text-late' : 'bg-sunken')}>{KIND_LABELS[a.kind]}</span>
                      <span>
                        <span className="num">{a.steps.length}</span> مهام
                      </span>
                      <span className={cn('inline-flex items-center gap-1', good ? 'text-done' : 'text-late')}>
                        {good ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
                        {good ? 'توزيع المهام مكتمل' : a.steps.length ? `المهام ${fmtPct(st)}` : 'بلا مهام'}
                      </span>
                    </p>
                  </button>
                  <WeightInput value={a.weight} onChange={(v) => setAct(a.id, { weight: v })} label={`وزن ${a.title}`} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={a.weight}
                    onChange={(e) => setAct(a.id, { weight: Number(e.target.value) })}
                    className="flex-1 accent-[var(--teal)]"
                    aria-label={`شريط وزن ${a.title}`}
                  />
                  <button onClick={() => choose(a.id)} className={cn('shrink-0 text-sm font-medium', sel ? 'text-ink' : 'text-teal hover:underline')}>
                    {sel ? 'المهام معروضة' : 'أوزان المهام ←'}
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {/* المستوى الثاني: مهام النشاط المختار */}
        <div ref={detailRef} className="scroll-mt-40">
          {current ? (
            <Panel className="lg:sticky lg:top-40">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <p className="text-xs text-muted">
                    {KIND_LABELS[current.kind]} {currentIndex + 1} من {acts.length} · وزنه {fmtPct(current.weight)}
                  </p>
                  <h2 className="font-semibold leading-snug text-ink">{current.title}</h2>
                  <p className={cn('mt-0.5 text-sm', ok100(stepTotals[current.id]) ? 'text-done' : 'text-late')}>
                    مجموع المهام <span className="num font-semibold">{fmtPct(stepTotals[current.id])}</span>
                    {!ok100(stepTotals[current.id]) && ` — ${stepTotals[current.id] > 100 ? 'زيادة' : 'متبقٍ'} ${fmtPct(Math.abs(round2(100 - stepTotals[current.id])))}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    className="h-9"
                    onClick={() => {
                      const s = suggestStepWeights(current.kind, current.steps);
                      setAct(current.id, { steps: current.steps.map((st, i) => ({ ...st, weight: s.weights[i], is_core: i === s.coreIndex })) });
                      toast.message(s.explanation);
                    }}
                  >
                    <Sparkles size={15} /> توزيع مقترح
                  </Button>
                  <Button variant="ghost" className="h-9" onClick={() => setAct(current.id, { steps: current.steps.map((st, i) => ({ ...st, weight: distribute(100, current.steps.length)[i] })) })}>
                    متساوٍ
                  </Button>
                </div>
              </div>
              <p className="border-b border-line bg-sunken/50 px-5 py-2 text-xs text-muted">
                <Star size={12} className="inline text-orange" /> المهمة الجوهرية تأخذ {CORE_STEP_WEIGHT}٪ وتتوزع {100 - CORE_STEP_WEIGHT}٪ على بقية المهام. قسّم المهمة الجوهرية الكبيرة إلى مراحل فرعية قابلة للقياس.
              </p>
              {current.steps.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">لا مهام في هذا النشاط. أضفها من صفحة الخطة.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {current.steps.map((s) => (
                    <StepRow
                      key={s.id}
                      s={s}
                      locked={locked}
                      onWeight={(v) => setStep(current.id, s.id, { weight: v })}
                      onCore={() => {
                        const n = current.steps.length;
                        const others = distribute(100 - CORE_STEP_WEIGHT, n - 1);
                        let k = 0;
                        setAct(current.id, {
                          steps: current.steps.map((x) =>
                            x.id === s.id
                              ? { ...x, is_core: true, weight: n === 1 ? 100 : n === 2 ? 50 : CORE_STEP_WEIGHT }
                              : { ...x, is_core: false, weight: n === 2 ? 50 : others[k++] },
                          ),
                        });
                      }}
                      onSubsteps={(subs) => setStep(current.id, s.id, { substeps: subs })}
                      onOutput={(o) => setStep(current.id, s.id, { output: o })}
                      quarter={quarter}
                    />
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
                <button className="text-teal disabled:opacity-30" disabled={currentIndex <= 0} onClick={() => setOpenAct(acts[currentIndex - 1].id)}>
                  → السابق
                </button>
                <button className="text-teal disabled:opacity-30" disabled={currentIndex >= acts.length - 1} onClick={() => setOpenAct(acts[currentIndex + 1].id)}>
                  التالي ←
                </button>
              </div>
            </Panel>
          ) : (
            <Panel className="p-8 text-center text-sm text-muted">اختر مشروعًا أو نشاطًا لعرض مهامه.</Panel>
          )}
        </div>
      </div>

      {locked && (
        <Panel className="p-5">
          <label htmlFor="rs" className="mb-1 block text-sm font-medium text-text">
            سبب التعديل <span className="text-stalled">*</span>
          </label>
          <Textarea id="rs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تغير نطاق مشروع بادية رواسم" />
          <div className="mt-3 flex justify-end">
            <Button disabled={pending || !ready || !reason.trim() || !dirty} onClick={() => save()}>
              {mode === 'direct' ? 'تطبيق التعديل كإصدار جديد' : 'إرسال طلب التعديل'}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function WeightInput({ value, onChange, label, small }: { value: number; onChange: (v: number) => void; label: string; small?: boolean }) {
  return (
    <div className={cn('relative shrink-0', small ? 'w-20' : 'w-24')}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="0.5"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onFocus={(e) => e.target.select()}
        className={cn('num pe-6 text-left font-semibold', small ? 'h-9' : 'h-11 text-lg')}
        dir="ltr"
        aria-label={label}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted">٪</span>
    </div>
  );
}

function StepRow({
  s,
  locked,
  quarter,
  onWeight,
  onCore,
  onSubsteps,
  onOutput,
}: {
  s: S;
  locked: boolean;
  quarter: number;
  onWeight: (v: number) => void;
  onCore: () => void;
  onSubsteps: (subs: Sub[]) => void;
  onOutput: (o: string | null) => void;
}) {
  const [editOut, setEditOut] = useState(false);
  const [out, setOut] = useState(s.output ?? '');
  const [saving, start] = useTransition();
  const subTotal = sum(s.substeps.map((x) => x.weight));
  const saveOut = () =>
    start(async () => {
      const r = await setRequiredOutputAction(s.id, out);
      if (!r.ok) return void toast.error(r.error);
      onOutput(out.trim() || null);
      setEditOut(false);
      toast.success(r.message);
    });
  return (
    <li className={cn('px-5 py-3.5', s.is_core && 'bg-orange-soft/40')}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onCore}
          aria-pressed={s.is_core}
          title={s.is_core ? 'المهمة الجوهرية' : `تعيين كمهمة جوهرية (${CORE_STEP_WEIGHT}٪)`}
          className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border transition', s.is_core ? 'border-orange bg-orange text-[#2b1700]' : 'border-line text-muted hover:border-orange hover:text-orange')}
        >
          <Star size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-ink">
            {s.title}
            {s.is_core && <span className="ms-2 rounded-full bg-orange px-2 py-0.5 text-[11px] font-semibold text-[#2b1700]">جوهرية</span>}
          </p>
          {editOut ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input value={out} onChange={(e) => setOut(e.target.value)} className="h-8 text-sm" autoFocus placeholder="المخرج المطلوب" aria-label="المخرج المطلوب" onKeyDown={(e) => e.key === 'Enter' && saveOut()} />
              <Button className="h-8 px-3" disabled={saving} onClick={saveOut}>
                حفظ
              </Button>
              <button className="text-muted" aria-label="إلغاء" onClick={() => (setEditOut(false), setOut(s.output ?? ''))}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditOut(true)} className="group mt-1 flex items-start gap-1 text-start text-xs">
              <span className="text-muted">المخرج المطلوب:</span>
              <span className={s.output ? 'text-text' : 'text-late'}>{s.output ?? 'لم يُحدد — أضفه'}</span>
              <Pencil size={11} className="mt-0.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
            </button>
          )}
          {s.responsible && <p className="mt-0.5 text-xs text-muted">المسؤول في الخطة: {s.responsible}</p>}
        </div>
        <div className="flex items-center gap-1">
          <WeightInput value={s.weight} onChange={onWeight} label={`وزن ${s.title}`} small />
          {!locked && (
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-text"
              title={s.substeps.length ? 'المراحل الفرعية' : 'تقسيم إلى مراحل فرعية'}
              aria-label="تقسيم إلى مراحل فرعية"
              onClick={() => {
                if (s.substeps.length) return;
                const cyc = suggestCycleSubsteps(s.weeks, quarter);
                onSubsteps(cyc.length ? cyc : [
                  { title: 'المرحلة الأولى', weight: 50 },
                  { title: 'المرحلة الثانية', weight: 50 },
                ]);
              }}
            >
              <Scissors size={15} />
            </button>
          )}
        </div>
      </div>
      {s.substeps.length > 0 && (
        <div className="ms-11 mt-3 rounded-xl bg-sunken p-3">
          <p className={cn('mb-2 text-xs', ok100(subTotal) ? 'text-muted' : 'text-late')}>مراحل فرعية قابلة للقياس — مجموعها {fmtPct(subTotal)} من وزن المهمة</p>
          <ul className="space-y-1.5">
            {s.substeps.map((x, xi) => (
              <li key={xi} className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 text-xs"
                  value={x.title}
                  disabled={locked}
                  aria-label="اسم المرحلة"
                  onChange={(e) => onSubsteps(s.substeps.map((y, yi) => (yi === xi ? { ...y, title: e.target.value } : y)))}
                />
                <Input
                  className="num h-8 w-20 text-left text-xs"
                  type="number"
                  dir="ltr"
                  value={x.weight}
                  disabled={locked}
                  aria-label="وزن المرحلة"
                  onChange={(e) => onSubsteps(s.substeps.map((y, yi) => (yi === xi ? { ...y, weight: Number(e.target.value) } : y)))}
                />
                {!locked && (
                  <button className="text-muted hover:text-stalled" aria-label="حذف المرحلة" onClick={() => onSubsteps(s.substeps.filter((_, yi) => yi !== xi))}>
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!locked && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onSubsteps([...s.substeps, { title: `المرحلة ${s.substeps.length + 1}`, weight: 0 }])}>
                <Plus size={13} /> مرحلة
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onSubsteps(s.substeps.map((y, yi) => ({ ...y, weight: distribute(100, s.substeps.length)[yi] })))}>
                بالتساوي
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-xs text-stalled" onClick={() => onSubsteps([])}>
                <Trash2 size={13} /> إلغاء التقسيم
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
