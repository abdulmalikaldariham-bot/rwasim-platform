'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Plus, Scissors, Star, Trash2, X } from 'lucide-react';
import { Button, Input, Label, Notice, Panel, Textarea } from '@/components/ui';
import { saveWeightsAction, submitPlanAction, approvePlanAction, requestChangeAction, directChangeAction } from '@/app/actions/plans';
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

const SEG = ['#326e7c', '#f09223', '#1d5160', '#6fb3c2', '#b46a12', '#4f8f9e', '#013047', '#e7b26b', '#2a6070', '#9cc9d2'];
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + (Number(x) || 0), 0));
const ok100 = (n: number) => Math.abs(n - 100) <= 0.01;

export function WeightsEditor({ planId, quarter, mode, isEd, activities: initial }: { planId: string; quarter: number; mode: 'draft' | 'request' | 'direct'; isEd: boolean; activities: A[] }) {
  const [acts, setActs] = useState<A[]>(initial);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [openAct, setOpenAct] = useState<string | null>(initial[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const locked = mode !== 'draft';

  const total = sum(acts.map((a) => a.weight));
  const stepTotals = Object.fromEntries(acts.map((a) => [a.id, sum(a.steps.map((s) => s.weight))]));
  const badActs = acts.filter((a) => !a.steps.length || !ok100(stepTotals[a.id]));
  const badSubs = acts.flatMap((a) => a.steps).filter((s) => s.substeps.length && !ok100(sum(s.substeps.map((x) => x.weight))));

  const setAct = (id: string, patch: Partial<A>) => setActs((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const setStep = (aid: string, sid: string, patch: Partial<S>) =>
    setActs((xs) => xs.map((a) => (a.id !== aid ? a : { ...a, steps: a.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) })));

  const checks = useMemo(() => {
    const steps = acts.flatMap((a) => a.steps);
    return [
      { label: 'البيانات الأساسية: كل نشاط له خطوات', ok: acts.length > 0 && acts.every((a) => a.steps.length > 0) },
      { label: `أوزان الأنشطة = 100٪ (الحالي ${fmtPct(total)})`, ok: ok100(total) },
      { label: 'أوزان خطوات كل نشاط = 100٪', ok: badActs.length === 0, detail: badActs.map((a) => `${a.title}: ${fmtPct(stepTotals[a.id])}`) },
      { label: 'أوزان المراحل الفرعية = 100٪ من الخطوة', ok: badSubs.length === 0, detail: badSubs.map((s) => s.title) },
      { label: 'لكل خطوة مسؤول', ok: steps.every((s) => s.responsible), detail: steps.filter((s) => !s.responsible).map((s) => s.title), soft: true },
      { label: 'لكل خطوة مخرج', ok: steps.every((s) => s.output), detail: steps.filter((s) => !s.output).map((s) => s.title), soft: true },
      { label: 'سلامة الجدولة: كل خطوة لها أسبوع تنفيذ', ok: steps.every((s) => s.weeks.length), detail: steps.filter((s) => !s.weeks.length).map((s) => s.title), soft: true },
    ];
  }, [acts, total, badActs, badSubs, stepTotals]);
  const ready = checks.filter((c) => !c.soft).every((c) => c.ok);

  const payload = () => ({
    planId,
    activities: acts.map((a) => ({ id: a.id, weight: round2(a.weight) })),
    steps: acts.flatMap((a) => a.steps.map((s) => ({ id: s.id, weight: round2(s.weight), is_core: s.is_core }))),
    substeps: locked ? undefined : acts.flatMap((a) => a.steps.map((s) => ({ stepId: s.id, items: s.substeps }))),
  });

  const save = (then?: 'submit' | 'approve') =>
    start(async () => {
      if (locked) {
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
      if (then === 'submit') {
        const s = await submitPlanAction(planId);
        if (!s.ok) return void toast.error(s.error);
        toast.success(s.message);
        return void router.push(`/plans/${planId}`);
      }
      if (then === 'approve') {
        const s = await approvePlanAction(planId);
        if (!s.ok) return void toast.error(s.error);
        toast.success(s.message);
        return void router.push(`/plans/${planId}`);
      }
      toast.success('حُفظت الأوزان');
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {locked && (
        <Notice tone="late" title="الخطة معتمدة">
          {mode === 'direct'
            ? 'أي تعديل هنا يُطبق كإصدار جديد من الأوزان ويُسجل في سجل التغييرات، ولا تتغير التقارير المعتمدة السابقة.'
            : 'التعديل يُرسل كطلب إلى المدير التنفيذي، ويطبق بعد موافقته كإصدار جديد. المراحل الفرعية لا تعدل بعد الاعتماد.'}
        </Notice>
      )}

      {/* شريط التكوين: كل نشاط طبقة بحجم وزنه */}
      <Panel className="p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-ink">تكوين خطة الإدارة</h2>
          <p className={cn('num text-2xl font-bold', ok100(total) ? 'text-done' : 'text-late')}>
            {fmtPct(total)} <span className="text-sm font-normal text-muted">من 100٪</span>
          </p>
        </div>
        <div className="flex h-9 overflow-hidden rounded-lg bg-sunken" role="img" aria-label="توزيع أوزان الأنشطة">
          {acts.map((a, i) =>
            a.weight > 0 ? (
              <button
                key={a.id}
                onClick={() => {
                  setOpenAct(a.id);
                  setStage(2);
                }}
                className="h-full border-l border-white/60 transition-[width] duration-300 dark:border-black/40"
                style={{ width: `${Math.min(100, (a.weight / Math.max(100, total)) * 100)}%`, background: SEG[i % SEG.length] }}
                title={`${a.title}: ${fmtPct(a.weight)}`}
              />
            ) : null,
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {ok100(total) ? 'المجموع مكتمل.' : total > 100 ? `زيادة ${fmtPct(round2(total - 100))} — خفّض بعض الأوزان.` : `متبقٍ ${fmtPct(round2(100 - total))} للتوزيع.`}
        </p>
      </Panel>

      <nav className="flex flex-wrap gap-2" aria-label="مراحل الأوزان">
        {(
          [
            [1, 'أوزان الأنشطة'],
            [2, 'أوزان الخطوات'],
            [3, 'المراجعة والاعتماد'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setStage(k)} aria-current={stage === k ? 'step' : undefined} className={cn('rounded-full border px-4 py-1.5 text-sm', stage === k ? 'border-teal bg-teal-soft font-semibold text-teal' : 'border-line text-muted')}>
            {k}. {l}
          </button>
        ))}
      </nav>

      {stage === 1 && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsEqual(xs.length)[i] })))}>
              توزيع بالتساوي
            </Button>
            <Button variant="secondary" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsByNature(xs.map((x) => ({ kind: x.kind, steps: x.steps })))[i] })))}>
              اقتراح حسب طبيعة النشاط
            </Button>
            {acts.some((a) => a.suggested !== null) && (
              <Button variant="ghost" onClick={() => setActs((xs) => xs.map((a) => ({ ...a, weight: a.suggested ?? a.weight })))}>
                استعادة المقترح عند الاستيراد
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {acts.map((a, i) => (
              <div key={a.id} className="relative overflow-hidden rounded-xl border border-line bg-surface p-4">
                <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: SEG[i % SEG.length] }} aria-hidden />
                <p className="font-semibold leading-snug text-ink">{a.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {KIND_LABELS[a.kind]} — {a.steps.length} خطوات
                  {a.suggested !== null ? ` — المقترح ${fmtPct(a.suggested)}` : ''}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={a.weight}
                    onChange={(e) => setAct(a.id, { weight: Number(e.target.value) })}
                    className="flex-1 accent-[var(--teal)]"
                    aria-label={`وزن ${a.title}`}
                  />
                  <div className="relative w-20">
                    <Input type="number" min={0} max={100} step="0.5" value={a.weight} onChange={(e) => setAct(a.id, { weight: Number(e.target.value) })} className="num pe-6 text-left" dir="ltr" aria-label={`الوزن المعتمد لـ ${a.title}`} />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted">٪</span>
                  </div>
                </div>
                <button className="mt-2 text-sm text-teal underline" onClick={() => (setOpenAct(a.id), setStage(2))}>
                  أوزان الخطوات {ok100(stepTotals[a.id]) ? '' : `(${fmtPct(stepTotals[a.id])})`}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {stage === 2 && (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <ul className="space-y-1">
            {acts.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpenAct(a.id)} className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm', openAct === a.id ? 'bg-teal-soft font-semibold text-teal' : 'hover:bg-sunken')}>
                  <span className="truncate">{a.title}</span>
                  {ok100(stepTotals[a.id]) ? <Check size={15} className="shrink-0 text-done" /> : <span className="num shrink-0 text-xs text-late">{fmtPct(stepTotals[a.id])}</span>}
                </button>
              </li>
            ))}
          </ul>
          {acts
            .filter((a) => a.id === openAct)
            .map((a) => (
              <Panel key={a.id} className="p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-ink">{a.title}</h2>
                    <p className={cn('text-sm', ok100(stepTotals[a.id]) ? 'text-done' : 'text-late')}>مجموع الخطوات {fmtPct(stepTotals[a.id])}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="h-9"
                      onClick={() => {
                        const s = suggestStepWeights(a.kind, a.steps);
                        setAct(a.id, { steps: a.steps.map((st, i) => ({ ...st, weight: s.weights[i], is_core: i === s.coreIndex })) });
                        toast.message(s.explanation);
                      }}
                    >
                      تطبيق القاعدة المقترحة
                    </Button>
                    <Button variant="ghost" className="h-9" onClick={() => setAct(a.id, { steps: a.steps.map((st, i) => ({ ...st, weight: distribute(100, a.steps.length)[i] })) })}>
                      بالتساوي
                    </Button>
                  </div>
                </div>
                <ul className="space-y-3">
                  {a.steps.map((s) => {
                    const subTotal = sum(s.substeps.map((x) => x.weight));
                    return (
                      <li key={s.id} className={cn('rounded-lg border p-3', s.is_core ? 'border-orange bg-orange-soft/40' : 'border-line')}>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              // تعيين الجوهرية: 40٪ لها و60٪ للباقي بالتساوي
                              const others = distribute(100 - CORE_STEP_WEIGHT, a.steps.length - 1);
                              let k = 0;
                              setAct(a.id, {
                                steps: a.steps.map((x) => (x.id === s.id ? { ...x, is_core: true, weight: a.steps.length === 1 ? 100 : a.steps.length === 2 ? 50 : CORE_STEP_WEIGHT } : { ...x, is_core: false, weight: a.steps.length === 2 ? 50 : others[k++] })),
                              });
                            }}
                            aria-pressed={s.is_core}
                            title="تعيين كخطوة جوهرية (40٪)"
                            className={cn('grid h-8 w-8 place-items-center rounded-full border', s.is_core ? 'border-orange bg-orange text-[#2b1700]' : 'border-line text-muted hover:border-orange')}
                          >
                            <Star size={15} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{s.title}</p>
                            <p className="text-xs text-muted">
                              {s.is_core ? 'الخطوة الجوهرية — ' : ''}
                              {s.responsible ?? 'بلا مسؤول'}
                              {s.suggested !== null ? ` — المقترح ${fmtPct(s.suggested)}` : ''}
                            </p>
                          </div>
                          <div className="relative w-24">
                            <Input type="number" min={0} max={100} step="0.5" value={s.weight} onChange={(e) => setStep(a.id, s.id, { weight: Number(e.target.value) })} className="num pe-6 text-left" dir="ltr" aria-label={`وزن ${s.title}`} />
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted">٪</span>
                          </div>
                          {!locked && (
                            <Button
                              variant="ghost"
                              className="h-8 px-2"
                              title="تقسيم إلى مراحل فرعية"
                              onClick={() => {
                                const cyc = suggestCycleSubsteps(s.weeks, quarter);
                                setStep(a.id, s.id, {
                                  substeps: s.substeps.length ? s.substeps : cyc.length ? cyc : [
                                    { title: 'المرحلة الأولى', weight: 50 },
                                    { title: 'المرحلة الثانية', weight: 50 },
                                  ],
                                });
                              }}
                            >
                              <Scissors size={15} />
                            </Button>
                          )}
                        </div>
                        {s.substeps.length > 0 && (
                          <div className="mt-3 rounded-lg bg-sunken p-3">
                            <p className={cn('mb-2 text-xs', ok100(subTotal) ? 'text-muted' : 'text-late')}>
                              مراحل فرعية قابلة للقياس — مجموعها {fmtPct(subTotal)} من وزن الخطوة
                            </p>
                            <ul className="space-y-1.5">
                              {s.substeps.map((x, xi) => (
                                <li key={xi} className="flex items-center gap-2">
                                  <Input
                                    className="h-8 flex-1 text-xs"
                                    value={x.title}
                                    disabled={locked}
                                    aria-label="اسم المرحلة"
                                    onChange={(e) => setStep(a.id, s.id, { substeps: s.substeps.map((y, yi) => (yi === xi ? { ...y, title: e.target.value } : y)) })}
                                  />
                                  <Input
                                    className="num h-8 w-20 text-left text-xs"
                                    type="number"
                                    dir="ltr"
                                    value={x.weight}
                                    disabled={locked}
                                    aria-label="وزن المرحلة"
                                    onChange={(e) => setStep(a.id, s.id, { substeps: s.substeps.map((y, yi) => (yi === xi ? { ...y, weight: Number(e.target.value) } : y)) })}
                                  />
                                  {!locked && (
                                    <button className="text-muted hover:text-stalled" aria-label="حذف المرحلة" onClick={() => setStep(a.id, s.id, { substeps: s.substeps.filter((_, yi) => yi !== xi) })}>
                                      <X size={15} />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                            {!locked && (
                              <div className="mt-2 flex gap-2">
                                <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStep(a.id, s.id, { substeps: [...s.substeps, { title: `المرحلة ${s.substeps.length + 1}`, weight: 0 }] })}>
                                  <Plus size={13} /> مرحلة
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStep(a.id, s.id, { substeps: s.substeps.map((y, yi) => ({ ...y, weight: distribute(100, s.substeps.length)[yi] })) })}>
                                  بالتساوي
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-xs text-stalled" onClick={() => setStep(a.id, s.id, { substeps: [] })}>
                                  <Trash2 size={13} /> إلغاء التقسيم
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
        </div>
      )}

      {stage === 3 && (
        <Panel className="max-w-3xl p-5">
          <h2 className="mb-3 font-semibold text-ink">جاهزية الخطة</h2>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white', c.ok ? 'bg-done' : c.soft ? 'bg-orange' : 'bg-stalled')}>{c.ok ? <Check size={12} /> : <X size={12} />}</span>
                <span>
                  {c.label}
                  {c.soft && !c.ok && <span className="text-muted"> (لا يمنع الاعتماد)</span>}
                  {!c.ok && c.detail && c.detail.length > 0 && <span className="block text-xs text-muted">{c.detail.slice(0, 5).join('، ')}{c.detail.length > 5 ? ` و${c.detail.length - 5} أخرى` : ''}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">بعد الاعتماد تصبح هذه الأوزان أساس احتساب الإنجاز، وتُحفظ كإصدار موثق.</p>
          {locked && (
            <div className="mt-4">
              <Label htmlFor="rs">سبب التعديل</Label>
              <Textarea id="rs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تغير نطاق مشروع بادية رواسم" />
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {!locked && (
              <>
                <Button variant="secondary" disabled={pending} onClick={() => save()}>
                  حفظ المسودة
                </Button>
                {isEd ? (
                  <Button disabled={pending || !ready} onClick={() => save('approve')}>
                    حفظ واعتماد الخطة
                  </Button>
                ) : (
                  <Button disabled={pending || !ready} onClick={() => save('submit')}>
                    حفظ ورفع للاعتماد
                  </Button>
                )}
              </>
            )}
            {locked && (
              <Button disabled={pending || !ready || !reason.trim()} onClick={() => save()}>
                {mode === 'direct' ? 'تطبيق التعديل' : 'إرسال طلب التعديل'}
              </Button>
            )}
          </div>
        </Panel>
      )}

      {stage !== 3 && (
        <div className="flex justify-between">
          {!locked ? (
            <Button variant="secondary" disabled={pending} onClick={() => save()}>
              حفظ المسودة
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => setStage((s) => (s === 1 ? 2 : 3))}>التالي</Button>
        </div>
      )}
    </div>
  );
}
