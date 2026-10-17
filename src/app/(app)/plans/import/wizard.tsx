'use client';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, Upload, AlertTriangle, Info, CircleAlert } from 'lucide-react';
import { Button, ButtonLink, Input, Label, Notice, Panel, Pill, Select } from '@/components/ui';
import { parseOperationalFileAction, createPlansFromImportAction, type ParsedUpload } from '@/app/actions/plans';
import type { ParsedSheet } from '@/lib/import/operational';
import { MONTHS, QUARTER_LABEL, PLAN_STATUS } from '@/lib/labels';
import { classifyActivity, KIND_LABELS } from '@/lib/engine/weights';
import { cn } from '@/lib/format';

type Existing = { id: string; year: number; quarter: number; departmentId: string; status: string };
const STAGES = ['الفترة', 'رفع الملف', 'مطابقة الأوراق', 'مراجعة المحتوى', 'الحفظ كمسودة'];

export function ImportWizard({
  years,
  initialYear,
  initialQuarter,
  depts,
  ownDept,
  existing,
}: {
  years: number[];
  initialYear: number;
  initialQuarter: number;
  depts: { id: string; name: string }[];
  ownDept: string | null;
  existing: Existing[];
}) {
  const [stage, setStage] = useState(0);
  const [year, setYear] = useState(initialYear);
  const [quarter, setQuarter] = useState(initialQuarter);
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<'nature' | 'equal'>('nature');
  const [cycles, setCycles] = useState(true);
  const [created, setCreated] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const months = [1, 2, 3].map((i) => (quarter - 1) * 3 + i);
  const chosen = sheets.filter((s) => include[s.sheetName] && mapping[s.sheetName]);
  const conflicts = chosen.filter((s) => existing.some((e) => e.year === year && e.quarter === quarter && e.departmentId === mapping[s.sheetName]));
  const dupDepts = chosen.map((s) => mapping[s.sheetName]).filter((d, i, a) => a.indexOf(d) !== i);

  const onFile = (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('year', String(year));
    fd.set('quarter', String(quarter));
    start(async () => {
      const r = await parseOperationalFileAction(fd);
      if (!r.ok) return void toast.error(r.error);
      setUpload(r.data);
      setSheets(r.data.workbook.sheets);
      const m: Record<string, string> = {};
      const inc: Record<string, boolean> = {};
      for (const s of r.data.suggestions) {
        const id = ownDept ? (s.departmentId === ownDept ? ownDept : '') : s.departmentId ?? '';
        m[s.sheetName] = id;
        inc[s.sheetName] = !!id;
      }
      setMapping(m);
      setInclude(inc);
      setStage(2);
    });
  };

  const updateStep = (sheet: string, ai: number, si: number, patch: Partial<ParsedSheet['activities'][number]['steps'][number]>) =>
    setSheets((all) =>
      all.map((s) =>
        s.sheetName !== sheet
          ? s
          : { ...s, activities: s.activities.map((a, i) => (i !== ai ? a : { ...a, steps: a.steps.map((st, j) => (j !== si ? st : { ...st, ...patch })) })) },
      ),
    );

  const create = () =>
    start(async () => {
      const r = await createPlansFromImportAction({
        year,
        quarter,
        importId: upload?.importId ?? null,
        sheets: chosen.map((s) => ({ departmentId: mapping[s.sheetName], sheet: s })),
        options: { activityWeightMode: mode, recurringCycles: cycles },
      });
      if (!r.ok) return void toast.error(r.error);
      setCreated(r.planIds);
      toast.success(`أنشئت ${r.planIds.length} خطط كمسودات`);
    });

  const yearMismatch = sheets.filter((s) => (s.year && s.year !== year) || (s.quarter && s.quarter !== quarter));

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="مراحل الاستيراد">
        {STAGES.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm', i === stage ? 'border-teal bg-teal-soft font-semibold text-teal' : i < stage ? 'border-line text-text' : 'border-line text-muted')} aria-current={i === stage ? 'step' : undefined}>
            <span className={cn('num grid h-5 w-5 place-items-center rounded-full text-xs', i < stage ? 'bg-done text-white' : i === stage ? 'bg-teal text-white' : 'bg-sunken')}>{i < stage ? '✓' : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {stage === 0 && (
        <Panel className="max-w-xl p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="y">السنة</Label>
              <Select id="y" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}م
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="q">الربع</Label>
              <Select id="q" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                {[1, 2, 3, 4].map((q) => (
                  <option key={q} value={q}>
                    {QUARTER_LABEL[q]} ({MONTHS[(q - 1) * 3 + 1]} – {MONTHS[q * 3]})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">
            نوع الخطة: تشغيلية ربعية. لاستيراد خطة تنفيذية سنوية استخدم{' '}
            <Link href={`/executive-plan?year=${year}`} className="text-teal underline">
              صفحة الخطة التنفيذية
            </Link>
            .
          </p>
          <Button className="mt-5" onClick={() => setStage(1)}>
            التالي
          </Button>
        </Panel>
      )}

      {stage === 1 && (
        <Panel className="max-w-xl p-5">
          <label
            htmlFor="xl"
            className="strata-bg flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line px-6 py-12 text-center hover:border-teal"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
          >
            {pending ? <FileSpreadsheet className="animate-pulse text-teal" size={36} /> : <Upload className="text-teal" size={36} />}
            <span className="font-semibold text-ink">{pending ? 'جارٍ تحليل أوراق العمل…' : 'اسحب ملف الخطة هنا أو اختره'}</span>
            <span className="text-sm text-muted">ملف xlsx — ورقة لكل إدارة. تُقرأ الجدولة سواء كانت بعلامات أو بتلوين الخلايا.</span>
          </label>
          <input id="xl" type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStage(0)}>
              السابق
            </Button>
            <ButtonLink variant="ghost" href={`/api/templates/operational?year=${year}&q=${quarter}`}>
              تنزيل القالب الفارغ
            </ButtonLink>
          </div>
        </Panel>
      )}

      {stage === 2 && upload && (
        <div className="space-y-4">
          <Notice tone="teal" title={upload.fileName}>
            وُجدت {sheets.length} أوراق خطط. اختر الإدارة المقابلة لكل ورقة؛ الأوراق غير المختارة لن تستورد.
          </Notice>
          {yearMismatch.length > 0 && (
            <Notice tone="late" title="تنبيه الفترة">
              عناوين بعض الأوراق تشير إلى فترة مختلفة عن {QUARTER_LABEL[quarter]} {year}م: {yearMismatch.map((s) => s.sheetName).join('، ')}. تأكد من اختيار الفترة الصحيحة.
            </Notice>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {sheets.map((s) => {
              const dept = mapping[s.sheetName];
              const ex = existing.find((e) => e.year === year && e.quarter === quarter && e.departmentId === dept);
              return (
                <Panel key={s.sheetName} className={cn('p-4', !include[s.sheetName] && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{s.sheetName}</p>
                      <p className="text-xs text-muted">{s.title}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={!!include[s.sheetName]} onChange={(e) => setInclude((x) => ({ ...x, [s.sheetName]: e.target.checked }))} />
                      استيراد
                    </label>
                  </div>
                  <div className="mt-3">
                    <Label htmlFor={`d-${s.sheetName}`}>الإدارة</Label>
                    <Select id={`d-${s.sheetName}`} value={dept ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [s.sheetName]: e.target.value }))}>
                      <option value="">— اختر —</option>
                      {depts
                        .filter((d) => !ownDept || d.id === ownDept)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </Select>
                    {ex && <p className="mt-1 text-xs text-late">توجد خطة لهذه الإدارة في الربع ({PLAN_STATUS[ex.status as 'draft']}). استخدم «إعادة الاستيراد» من صفحة الخطة للمقارنة.</p>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {s.columns.map((c) => (
                      <div key={c.field} className="contents">
                        <dt className="text-muted">{c.field}</dt>
                        <dd>
                          <span className="num rounded bg-sunken px-1">{c.column}</span> {c.header}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-sm">
                    <span className="num font-semibold">{s.stats.activities}</span> أنشطة، <span className="num font-semibold">{s.stats.steps}</span> خطوة، منها{' '}
                    <span className="num font-semibold">{s.stats.scheduledSteps}</span> مجدولة —{' '}
                    {{ marks: 'الجدولة بالعلامات', fill: 'الجدولة بتلوين الخلايا', mixed: 'الجدولة بالعلامات والتلوين', none: 'بلا جدولة' }[s.scheduleMode]}
                  </p>
                </Panel>
              );
            })}
          </div>
          {dupDepts.length > 0 && <Notice tone="stalled">اخترت الإدارة نفسها لأكثر من ورقة.</Notice>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage(1)}>
              ملف آخر
            </Button>
            <Button disabled={!chosen.length || dupDepts.length > 0 || conflicts.length > 0} onClick={() => setStage(3)}>
              مراجعة المحتوى ({chosen.length})
            </Button>
          </div>
        </div>
      )}

      {stage === 3 && (
        <div className="space-y-5">
          <Notice tone="teal">
            راجع المسؤولين والمخرجات والجدولة. انقر على خلية أسبوع لإضافتها أو إزالتها. عبارات عمود «المتابعة» تظهر للاطلاع فقط ولا تُحتسب إنجازًا.
          </Notice>
          {chosen.map((s) => (
            <SheetReview key={s.sheetName} sheet={s} months={months} deptName={depts.find((d) => d.id === mapping[s.sheetName])?.name ?? ''} onStep={(ai, si, patch) => updateStep(s.sheetName, ai, si, patch)} />
          ))}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage(2)}>
              السابق
            </Button>
            <Button onClick={() => setStage(4)}>التالي</Button>
          </div>
        </div>
      )}

      {stage === 4 && (
        <Panel className="max-w-2xl p-5">
          {created ? (
            <div className="space-y-4">
              <p className="text-lg font-semibold text-ink">أنشئت {created.length} خطط كمسودات</p>
              <p className="text-sm text-muted">الخطوة التالية: مراجعة الأوزان المقترحة واعتمادها لكل خطة، ثم رفعها للمدير التنفيذي.</p>
              <ul className="space-y-2">
                {created.map((id, i) => (
                  <li key={id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                    <span>{depts.find((d) => d.id === mapping[chosen[i]?.sheetName])?.name}</span>
                    <ButtonLink href={`/plans/${id}/weights`} className="h-8">
                      ضبط الأوزان
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="font-semibold text-ink">إعدادات الأوزان المقترحة</h2>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">أوزان الأنشطة داخل كل إدارة</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="mode" className="mt-1 accent-[var(--teal)]" checked={mode === 'nature'} onChange={() => setMode('nature')} />
                  <span>
                    حسب طبيعة النشاط وحجمه <span className="text-muted">(المشاريع والإنشاء أثقل من الأعمال المتكررة)</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="mode" className="mt-1 accent-[var(--teal)]" checked={mode === 'equal'} onChange={() => setMode('equal')} />
                  توزيع متساوٍ
                </label>
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--teal)]" checked={cycles} onChange={(e) => setCycles(e.target.checked)} />
                <span>
                  تقسيم خطوات الأعمال المتكررة إلى دورات شهرية <span className="text-muted">(مثل المشتريات الدورية: يُحتسب الإنجاز بكل دورة منجزة)</span>
                </span>
              </label>
              <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
                تأخذ الخطوة الجوهرية 40٪ من وزن نشاطها افتراضيًا، والمشاريع تتبع القالب 10/10/10/20/40/10. كل هذه اقتراحات تراجعها في الشاشة التالية قبل الاعتماد.
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStage(3)}>
                  السابق
                </Button>
                <Button onClick={create} disabled={pending}>
                  {pending ? 'جارٍ الحفظ…' : `حفظ ${chosen.length} خطط كمسودات`}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function SheetReview({
  sheet,
  months,
  deptName,
  onStep,
}: {
  sheet: ParsedSheet;
  months: number[];
  deptName: string;
  onStep: (ai: number, si: number, patch: Partial<ParsedSheet['activities'][number]['steps'][number]>) => void;
}) {
  const [open, setOpen] = useState(true);
  const issues = useMemo(() => sheet.issues, [sheet.issues]);
  const icon = { error: <CircleAlert size={14} className="text-stalled" />, warning: <AlertTriangle size={14} className="text-late" />, info: <Info size={14} className="text-teal" /> };
  return (
    <Panel>
      <button className="flex w-full items-center justify-between px-5 py-4 text-right" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="font-semibold text-ink">{deptName}</span>
          <span className="ms-2 text-sm text-muted">{sheet.stats.activities} أنشطة، {sheet.stats.steps} خطوة</span>
        </span>
        <span className="flex gap-1.5">
          {issues.filter((i) => i.level === 'error').length > 0 && <Pill tone="stalled">{issues.filter((i) => i.level === 'error').length} أخطاء</Pill>}
          {issues.filter((i) => i.level === 'warning').length > 0 && <Pill tone="late">{issues.filter((i) => i.level === 'warning').length} تنبيهات</Pill>}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-5 py-4">
          {issues.length > 0 && (
            <details className="mb-4 rounded-lg bg-sunken p-3 text-sm" open={issues.some((i) => i.level !== 'info')}>
              <summary className="cursor-pointer font-medium">ملاحظات التحليل ({issues.length})</summary>
              <ul className="mt-2 space-y-1">
                {issues.map((i, k) => (
                  <li key={k} className="flex items-start gap-1.5">
                    <span className="mt-1">{icon[i.level]}</span>
                    <span>
                      {i.row ? <span className="num text-muted">صف {i.row}: </span> : null}
                      {i.message}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ol className="space-y-5">
            {sheet.activities.map((a, ai) => (
              <li key={ai}>
                <p className="mb-2 font-semibold text-ink">
                  {a.title} <span className="text-xs font-normal text-muted">— {KIND_LABELS[classifyActivity(a.title, a.steps.map((s) => s.title))]}</span>
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="w-[30%] py-1 text-right font-medium">الخطوة</th>
                        <th className="w-[18%] py-1 text-right font-medium">المسؤول</th>
                        <th className="w-[22%] py-1 text-right font-medium">المخرج</th>
                        <th className="py-1 text-right font-medium">
                          الجدولة ({months.map((m) => MONTHS[m]).join(' / ')})
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.steps.map((st, si) => (
                        <tr key={si} className="border-t border-line align-top">
                          <td className="py-2 pe-2">
                            {st.title}
                            {st.followup && <span className="mt-0.5 block text-xs text-muted">المتابعة في الملف: «{st.followup}» (للمراجعة)</span>}
                          </td>
                          <td className="py-1.5 pe-2">
                            <Input className={cn('h-8 text-xs', !st.responsible && 'border-orange')} value={st.responsible ?? ''} onChange={(e) => onStep(ai, si, { responsible: e.target.value || null })} aria-label="المسؤول" />
                          </td>
                          <td className="py-1.5 pe-2">
                            <Input className={cn('h-8 text-xs', !st.output && 'border-orange')} value={st.output ?? ''} onChange={(e) => onStep(ai, si, { output: e.target.value || null })} aria-label="المخرج" />
                          </td>
                          <td className="py-2">
                            <div className="flex gap-0.5">
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => {
                                const on = st.weeks.includes(w);
                                return (
                                  <button
                                    key={w}
                                    type="button"
                                    onClick={() => onStep(ai, si, { weeks: on ? st.weeks.filter((x) => x !== w) : [...st.weeks, w].sort((x, y) => x - y) })}
                                    className={cn('h-6 w-5 rounded-sm text-[10px]', w % 4 === 1 && w > 1 && 'ms-1', on ? 'bg-teal text-white' : 'bg-sunken text-muted hover:bg-teal-soft')}
                                    title={`${MONTHS[months[Math.floor((w - 1) / 4)]]} — الأسبوع ${((w - 1) % 4) + 1}`}
                                    aria-pressed={on}
                                  >
                                    {st.intensities[w] ?? ''}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
