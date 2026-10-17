'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronLeft, History, Plus, RotateCcw, Save, Scissors, Sparkles, Star, Trash2, X } from 'lucide-react';
import { Button, Input, Label, Notice, Panel, Textarea } from '@/components/ui';
import { saveWeightsAction, submitPlanAction, approvePlanAction, requestChangeAction, directChangeAction, saveSuggestedWeightsAction } from '@/app/actions/plans';
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
import { cn, fmtDateTime, fmtPct } from '@/lib/format';

type Sub = { title: string; weight: number };
type S = { id: string; title: string; weight: number; suggested: number | null; is_core: boolean; responsible: string | null; output: string | null; weeks: number[]; substeps: Sub[] };
type A = { id: string; title: string; kind: ActivityKind; weight: number; suggested: number | null; steps: S[] };
export type HistoryRow = { at: string; actor_name: string; item_kind: string; item_title: string | null; old_weight: number | null; new_weight: number | null; action: string };

const SEG = ['#336e7c', '#ef9122', '#15516c', '#74b7c5', '#b46a12', '#4f8f9e', '#0e4156', '#e7b26b', '#2a6070', '#9cc9d2'];
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + (Number(x) || 0), 0));
const ok100 = (n: number) => Math.abs(n - 100) <= 0.01;

/** شريط المجموع من 100٪ */
function TotalBar({ parts, total, label }: { parts: { key: string; weight: number; color: string; title: string; onClick?: () => void }[]; total: number; label: string }) {
  return (
    <div>
      <div className="flex h-8 overflow-hidden rounded-full bg-sunken" role="img" aria-label={label}>
        {parts.map((p) =>
          p.weight > 0 ? (
            <button
              key={p.key}
              type="button"
              onClick={p.onClick}
              className="h-full border-l-2 border-surface transition-[width] duration-300 last:border-l-0"
              style={{ width: `${Math.min(100, (p.weight / Math.max(100, total)) * 100)}%`, background: p.color }}
              title={`${p.title}: ${fmtPct(p.weight)}`}
            />
          ) : null,
        )}
      </div>
      <p className={cn('mt-1.5 text-sm', ok100(total) ? 'text-done' : 'text-late')}>
        {ok100(total) ? '✓ المجموع 100٪' : total > 100 ? `زيادة ${fmtPct(round2(total - 100))} — خفّض بعض الأوزان` : `متبقٍ ${fmtPct(round2(100 - total))} للتوزيع`}
      </p>
    </div>
  );
}

function PctInput({ value, onChange, label, disabled, className }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <div className={cn('relative w-24 shrink-0', className)}>
      <Input
        type="number"
        min={0}
        max={100}
        step="0.5"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={(e) => e.target.select()}
        className="num h-9 rounded-full pe-7 text-left font-semibold"
        dir="ltr"
        aria-label={label}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">٪</span>
    </div>
  );
}

export function WeightsEditor({
  planId,
  quarter,
  mode,
  isEd,
  activities: initial,
  history,
}: {
  planId: string;
  quarter: number;
  mode: 'draft' | 'request' | 'direct';
  isEd: boolean;
  activities: A[];
  history: HistoryRow[];
}) {
  const [acts, setActs] = useState<A[]>(initial);
  const [openAct, setOpenAct] = useState<string | null>(initial[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const locked = mode !== 'draft';
  const dirty = JSON.stringify(acts) !== JSON.stringify(initial);

  const total = sum(acts.map((a) => a.weight));
  const stepTotals = Object.fromEntries(acts.map((a) => [a.id, sum(a.steps.map((s) => s.weight))]));
  const badActs = acts.filter((a) => !a.steps.length || !ok100(stepTotals[a.id]));
  const badSubs = acts.flatMap((a) => a.steps).filter((s) => s.substeps.length && !ok100(sum(s.substeps.map((x) => x.weight))));
  const noCore = acts.filter((a) => a.steps.length > 2 && !a.steps.some((s) => s.is_core));

  const setAct = (id: string, patch: Partial<A>) => setActs((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const setStep = (aid: string, sid: string, patch: Partial<S>) =>
    setActs((xs) => xs.map((a) => (a.id !== aid ? a : { ...a, steps: a.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) })));

  const errors = useMemo(() => {
    const e: string[] = [];
    if (!acts.length) e.push('لا توجد مشاريع أو أنشطة في الخطة');
    if (!ok100(total)) e.push(`مجموع أوزان المشاريع والأنشطة ${fmtPct(total)} ويجب أن يساوي 100٪`);
    for (const a of badActs) e.push(a.steps.length ? `مهام «${a.title}» مجموعها ${fmtPct(stepTotals[a.id])}` : `«${a.title}» بلا مهام تنفيذية`);
    for (const s of badSubs) e.push(`المراحل الفرعية لـ «${s.title}» لا تساوي 100٪`);
    if ([...acts.map((a) => a.weight), ...acts.flatMap((a) => a.steps.map((s) => s.weight))].some((w) => !(w >= 0) || w > 100)) e.push('توجد أوزان خارج النطاق 0–100');
    return e;
  }, [acts, total, badActs, badSubs, stepTotals]);
  const ready = errors.length === 0;

  const payload = () => ({
    planId,
    activities: acts.map((a) => ({ id: a.id, weight: round2(a.weight) })),
    steps: acts.flatMap((a) => a.steps.map((s) => ({ id: s.id, weight: round2(s.weight), is_core: s.is_core }))),
    substeps: locked ? undefined : acts.flatMap((a) => a.steps.map((s) => ({ stepId: s.id, items: s.substeps }))),
  });

  const save = (then?: 'submit' | 'approve') =>
    start(async () => {
      if (locked) {
        if (!ready) return void toast.error('أكمل التوزيع أولًا: ' + errors[0]);
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
      if (then === 'submit' || then === 'approve') {
        const s = then === 'submit' ? await submitPlanAction(planId) : await approvePlanAction(planId);
        if (!s.ok) return void toast.error(s.error);
        toast.success(s.message);
        return void router.push(`/plans/${planId}`);
      }
      toast.success('حُفظت الأوزان');
      router.refresh();
    });

  const saveSuggested = () =>
    start(async () => {
      const p = payload();
      const r = await saveSuggestedWeightsAction({ planId, activities: p.activities, steps: p.steps.map(({ id, weight }) => ({ id, weight })) });
      if (!r.ok) return void toast.error(r.error);
      setActs((xs) => xs.map((a) => ({ ...a, suggested: a.weight, steps: a.steps.map((s) => ({ ...s, suggested: s.weight })) })));
      toast.success(r.message);
    });

  const applyCoreRule = (a: A, coreId?: string) => {
    if (coreId) {
      const n = a.steps.length;
      const others = distribute(100 - CORE_STEP_WEIGHT, n - 1);
      let k = 0;
      setAct(a.id, {
        steps: a.steps.map((x) =>
          x.id === coreId ? { ...x, is_core: true, weight: n === 1 ? 100 : n === 2 ? 50 : CORE_STEP_WEIGHT } : { ...x, is_core: false, weight: n === 2 ? 50 : others[k++] },
        ),
      });
      return;
    }
    const s = suggestStepWeights(a.kind, a.steps);
    setAct(a.id, { steps: a.steps.map((st, i) => ({ ...st, weight: s.weights[i], is_core: i === s.coreIndex })) });
    toast.message(s.explanation);
  };

  const cur = acts.find((a) => a.id === openAct) ?? null;
  const curIdx = cur ? acts.indexOf(cur) : -1;

  return (
    <div className="space-y-5">
      {locked && (
        <Notice tone="late" title="الخطة معتمدة">
          {mode === 'direct'
            ? 'أي تعديل هنا يُطبق كإصدار جديد من الأوزان ويُسجل في سجل التغييرات، ولا تتغير التقارير المعتمدة السابقة.'
            : 'التعديل يُرسل كطلب إلى المدير التنفيذي، ويطبق بعد موافقته كإصدار جديد. المراحل الفرعية لا تعدل بعد الاعتماد.'}
        </Notice>
      )}

      {/* شريط الحالة والحفظ — ثابت أعلى الشاشة */}
      <div className="card sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 p-3 ps-5 lg:top-4">
        <div className="flex items-center gap-3">
          <span className={cn('grid h-9 w-9 place-items-center rounded-full', ready ? 'bg-done-soft text-done' : 'bg-orange-soft text-late')}>{ready ? <Check size={18} /> : <AlertTriangle size={18} />}</span>
          <div>
            <p className="text-sm font-bold text-ink">{ready ? 'التوزيع مكتمل وجاهز' : `${errors.length} ملاحظات قبل الاعتماد`}</p>
            <p className="text-xs text-muted">{dirty ? 'لديك تغييرات غير محفوظة' : 'لا تغييرات غير محفوظة'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="h-9" onClick={() => setShowHistory((v) => !v)}>
            <History size={16} /> سجل التعديلات
          </Button>
          <Button variant="secondary" className="h-9" disabled={pending} onClick={saveSuggested} title="يحفظ التوزيع الحالي كمقترح دون اعتماده">
            <Sparkles size={16} /> حفظ كتوزيع مقترح
          </Button>
          {!locked && (
            <>
              <Button variant="secondary" className="h-9" disabled={pending || !dirty} onClick={() => save()}>
                <Save size={16} /> حفظ
              </Button>
              <Button className="h-9" disabled={pending || !ready} onClick={() => save(isEd ? 'approve' : 'submit')} title={ready ? undefined : errors[0]}>
                {isEd ? 'حفظ واعتماد الخطة' : 'حفظ ورفع للاعتماد'}
              </Button>
            </>
          )}
        </div>
      </div>

      {!ready && (
        <div className="rounded-2xl border border-orange/30 bg-orange-soft/60 px-4 py-3 text-sm">
          <p className="mb-1 font-bold text-late">لا يمكن اعتماد توزيع غير مكتمل:</p>
          <ul className="list-disc space-y-0.5 ps-5 text-text">
            {errors.slice(0, 6).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > 6 && <li>و{errors.length - 6} ملاحظات أخرى</li>}
          </ul>
        </div>
      )}

      {showHistory && (
        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">سجل تعديلات الأوزان</h2>
            <button className="text-muted hover:text-text" onClick={() => setShowHistory(false)} aria-label="إغلاق">
              <X size={18} />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted">لا توجد تعديلات مسجلة بعد.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{h.item_title ?? '—'}</span>
                    <span className="text-muted"> · {h.item_kind === 'activity' ? 'مشروع/نشاط' : 'مهمة'}</span>
                  </span>
                  <span className="num text-xs">
                    {h.action === 'INSERT' ? `أُضيف بوزن ${fmtPct(h.new_weight)}` : h.action === 'DELETE' ? 'حُذف' : `${fmtPct(h.old_weight)} ← ${fmtPct(h.new_weight)}`}
                  </span>
                  <span className="w-full text-xs text-muted">
                    {h.actor_name} · {fmtDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(22rem,0.9fr)_1.1fr]">
        {/* المستوى الأول: المشاريع والأنشطة */}
        <Panel className="self-start p-5">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-late">المستوى الأول</p>
              <h2 className="text-lg font-bold text-ink">أوزان المشاريع والأنشطة</h2>
            </div>
            <p className={cn('num text-2xl font-bold', ok100(total) ? 'text-done' : 'text-late')}>{fmtPct(total)}</p>
          </div>
          <TotalBar
            label="توزيع أوزان المشاريع والأنشطة"
            total={total}
            parts={acts.map((a, i) => ({ key: a.id, weight: a.weight, color: SEG[i % SEG.length], title: a.title, onClick: () => setOpenAct(a.id) }))}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsEqual(xs.length)[i] })))}>
              توزيع متساوٍ
            </Button>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setActs((xs) => xs.map((a, i) => ({ ...a, weight: suggestActivityWeightsByNature(xs.map((x) => ({ kind: x.kind, steps: x.steps })))[i] })))}>
              <Sparkles size={13} /> اقتراح حسب الطبيعة
            </Button>
            {acts.some((a) => a.suggested !== null) && (
              <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setActs((xs) => xs.map((a) => ({ ...a, weight: a.suggested ?? a.weight, steps: a.steps.map((s) => ({ ...s, weight: s.suggested ?? s.weight })) })))}>
                <RotateCcw size={13} /> استعادة المقترح
              </Button>
            )}
          </div>
          <ul className="mt-4 space-y-2">
            {acts.map((a, i) => {
              const okSteps = a.steps.length > 0 && ok100(stepTotals[a.id]);
              const on = a.id === openAct;
              return (
                <li
                  key={a.id}
                  className={cn('relative overflow-hidden rounded-2xl border p-3 ps-4 transition', on ? 'border-teal bg-teal-soft/50 shadow-card' : 'border-line hover:border-teal/40')}
                >
                  <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: SEG[i % SEG.length] }} aria-hidden />
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setOpenAct(a.id)} className="min-w-0 flex-1 text-right">
                      <p className="truncate font-bold text-ink">{a.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{KIND_LABELS[a.kind]}</span>
                        <span>· {a.steps.length} مهام</span>
                        <span className={okSteps ? 'text-done' : 'text-late'}>· {okSteps ? 'أوزان المهام مكتملة' : a.steps.length ? `المهام ${fmtPct(stepTotals[a.id])}` : 'بلا مهام'}</span>
                        {a.suggested !== null && a.suggested !== a.weight && <span>· المقترح {fmtPct(a.suggested)}</span>}
                      </p>
                    </button>
                    <PctInput value={a.weight} onChange={(n) => setAct(a.id, { weight: n })} label={`وزن ${a.title}`} />
                    <button type="button" onClick={() => setOpenAct(a.id)} aria-label="عرض المهام" className={cn('grid h-8 w-8 place-items-center rounded-full', on ? 'bg-teal text-white' : 'text-muted hover:bg-sunken')}>
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {noCore.length > 0 && <p className="mt-3 text-xs text-muted">لم تُحدد المهمة الجوهرية في {noCore.length} أعمال.</p>}
        </Panel>

        {/* المستوى الثاني: مهام النشاط المختار */}
        {cur ? (
          <Panel className="self-start p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-late">المستوى الثاني · المهام داخل {cur.kind === 'project' ? 'المشروع' : 'النشاط'}</p>
                <h2 className="text-lg font-bold text-ink">{cur.title}</h2>
                <p className="text-xs text-muted">
                  وزنه في خطة الإدارة {fmtPct(cur.weight)} · {cur.steps.length} مهام
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" className="h-8 px-2" disabled={curIdx <= 0} onClick={() => setOpenAct(acts[curIdx - 1].id)} aria-label="السابق">
                  →
                </Button>
                <Button variant="ghost" className="h-8 px-2" disabled={curIdx >= acts.length - 1} onClick={() => setOpenAct(acts[curIdx + 1].id)} aria-label="التالي">
                  ←
                </Button>
              </div>
            </div>
            <TotalBar
              label="توزيع أوزان المهام"
              total={stepTotals[cur.id]}
              parts={cur.steps.map((s, i) => ({ key: s.id, weight: s.weight, color: s.is_core ? 'var(--orange)' : SEG[(i * 3) % SEG.length], title: s.title }))}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => applyCoreRule(cur)}>
                <Star size={13} /> قاعدة 40٪ للمهمة الجوهرية
              </Button>
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setAct(cur.id, { steps: cur.steps.map((st, i) => ({ ...st, weight: distribute(100, cur.steps.length)[i] })) })}>
                توزيع متساوٍ
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">القاعدة المعتمدة: المهمة الجوهرية 40٪، و60٪ للباقي بحسب أهميتها. يمكن التعديل على أن يبقى المجموع 100٪.</p>
            <ul className="mt-4 space-y-2.5">
              {cur.steps.length === 0 && <li className="rounded-2xl bg-orange-soft px-4 py-3 text-sm text-late">لا توجد مهام في هذا العمل — أضفها من صفحة الخطة.</li>}
              {cur.steps.map((s) => {
                const subTotal = sum(s.substeps.map((x) => x.weight));
                return (
                  <li key={s.id} className={cn('rounded-2xl border p-3', s.is_core ? 'border-orange/60 bg-orange-soft/40' : 'border-line')}>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => applyCoreRule(cur, s.id)}
                        aria-pressed={s.is_core}
                        title="تعيين كمهمة جوهرية (40٪)"
                        className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full border transition', s.is_core ? 'border-orange bg-orange text-[#2b1700]' : 'border-line text-muted hover:border-orange hover:text-orange')}
                      >
                        <Star size={15} className={s.is_core ? 'fill-current' : undefined} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {s.title}
                          {s.is_core && <span className="ms-2 rounded-full bg-orange px-2 py-0.5 text-[11px] font-bold text-[#2b1700]">الجوهرية</span>}
                        </p>
                        <p className="truncate text-xs text-muted">المخرج المطلوب: {s.output ?? '—'}</p>
                      </div>
                      <PctInput value={s.weight} onChange={(n) => setStep(cur.id, s.id, { weight: n })} label={`وزن ${s.title}`} />
                      {!locked && (
                        <button
                          type="button"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken"
                          title="تقسيم إلى مراحل فرعية لقياس التقدم بدقة"
                          onClick={() => {
                            const cyc = suggestCycleSubsteps(s.weeks, quarter);
                            setStep(cur.id, s.id, {
                              substeps: s.substeps.length ? s.substeps : cyc.length ? cyc : [
                                { title: 'المرحلة الأولى', weight: 50 },
                                { title: 'المرحلة الثانية', weight: 50 },
                              ],
                            });
                          }}
                        >
                          <Scissors size={15} />
                        </button>
                      )}
                    </div>
                    {s.substeps.length > 0 && locked && (
                      <p className="mt-2 flex flex-wrap gap-1.5 ps-12 text-xs text-muted">
                        مراحل فرعية:
                        {s.substeps.map((x, xi) => (
                          <span key={xi} className="rounded-full bg-sunken px-2 py-0.5">
                            {x.title} <span className="num">{fmtPct(x.weight)}</span>
                          </span>
                        ))}
                      </p>
                    )}
                    {s.substeps.length > 0 && !locked && (
                      <div className="mt-3 rounded-xl bg-surface/70 p-3">
                        <p className={cn('mb-2 text-xs', ok100(subTotal) ? 'text-muted' : 'text-late')}>مراحل فرعية — مجموعها {fmtPct(subTotal)} من وزن المهمة</p>
                        <ul className="space-y-1.5">
                          {s.substeps.map((x, xi) => (
                            <li key={xi} className="flex items-center gap-2">
                              <Input
                                className="h-8 flex-1 text-xs"
                                value={x.title}
                                disabled={locked}
                                aria-label="اسم المرحلة"
                                onChange={(e) => setStep(cur.id, s.id, { substeps: s.substeps.map((y, yi) => (yi === xi ? { ...y, title: e.target.value } : y)) })}
                              />
                              <PctInput className="w-20" value={x.weight} disabled={locked} label="وزن المرحلة" onChange={(n) => setStep(cur.id, s.id, { substeps: s.substeps.map((y, yi) => (yi === xi ? { ...y, weight: n } : y)) })} />
                              {!locked && (
                                <button className="text-muted hover:text-stalled" aria-label="حذف المرحلة" onClick={() => setStep(cur.id, s.id, { substeps: s.substeps.filter((_, yi) => yi !== xi) })}>
                                  <X size={15} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {!locked && (
                          <div className="mt-2 flex gap-2">
                            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStep(cur.id, s.id, { substeps: [...s.substeps, { title: `المرحلة ${s.substeps.length + 1}`, weight: 0 }] })}>
                              <Plus size={13} /> مرحلة
                            </Button>
                            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStep(cur.id, s.id, { substeps: s.substeps.map((y, yi) => ({ ...y, weight: distribute(100, s.substeps.length)[yi] })) })}>
                              بالتساوي
                            </Button>
                            <Button variant="ghost" className="h-7 px-2 text-xs text-stalled" onClick={() => setStep(cur.id, s.id, { substeps: [] })}>
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
        ) : (
          <Panel className="grid place-items-center p-10 text-sm text-muted">اختر مشروعًا أو نشاطًا لعرض مهامه</Panel>
        )}
      </div>

      {locked && (
        <Panel className="max-w-3xl p-5">
          <Label htmlFor="rs">سبب التعديل</Label>
          <Textarea id="rs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تغير نطاق مشروع بادية رواسم" />
          <Button className="mt-3" disabled={pending || !ready || !reason.trim() || !dirty} onClick={() => save()}>
            {mode === 'direct' ? 'تطبيق التعديل كإصدار جديد' : 'إرسال طلب التعديل للمدير التنفيذي'}
          </Button>
        </Panel>
      )}
    </div>
  );
}
