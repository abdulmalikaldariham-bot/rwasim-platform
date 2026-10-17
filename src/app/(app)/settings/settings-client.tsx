'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Input, Label, Pill } from '@/components/ui';
import {
  archiveYearAction,
  createYearAction,
  markWeeksReviewedAction,
  saveSettingAction,
  setDeptWeightsAction,
  toggleDepartmentAction,
  updateWeekAction,
  upsertDepartmentAction,
} from '@/app/actions/settings';
import { MONTHS } from '@/lib/labels';
import { fmtPct } from '@/lib/format';

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return {
    pending,
    run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, done?: () => void) =>
      start(async () => {
        const r = await fn();
        if (r.ok) {
          if (r.message) toast.success(r.message);
          done?.();
          router.refresh();
        } else toast.error(r.error ?? 'تعذر التنفيذ');
      }),
  };
}

export function YearsPanel({ years, canEdit }: { years: { year: number; status: string; is_transitional: boolean }[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const next = (years[0]?.year ?? new Date().getFullYear()) + 1;
  const [y, setY] = useState(next);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {years.map((x) => (
          <li key={x.year} className="flex items-center justify-between gap-2 py-2.5">
            <span className="flex items-center gap-2">
              <span className="num font-semibold">{x.year}م</span>
              {x.is_transitional && <Pill tone="nodata">انتقالية</Pill>}
              <Pill tone={x.status === 'archived' ? 'nodata' : x.status === 'active' ? 'done' : 'teal'}>{{ planning: 'تخطيط', active: 'نشطة', archived: 'مؤرشفة' }[x.status as 'active']}</Pill>
            </span>
            {canEdit && x.status !== 'archived' && (
              <Button
                variant="ghost"
                className="h-8 text-xs"
                disabled={pending}
                onClick={() => confirm(`أرشفة ${x.year}م؟ ستُقفل خططها ونتائجها ولا يمكن تعديلها.`) && run(() => archiveYearAction(x.year))}
              >
                أرشفة
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createYearAction(y, false));
          }}
        >
          <div>
            <Label htmlFor="ny">سنة جديدة</Label>
            <Input id="ny" type="number" className="w-28" value={y} onChange={(e) => setY(Number(e.target.value))} dir="ltr" />
          </div>
          <Button disabled={pending}>إنشاء السنة</Button>
        </form>
      )}
    </div>
  );
}

export function DeptWeightsPanel({ year, canEdit, depts }: { year: number; canEdit: boolean; depts: { id: string; name: string; active: boolean; weight: number }[] }) {
  const { pending, run } = useRun();
  const [w, setW] = useState(Object.fromEntries(depts.map((d) => [d.id, d.weight])));
  const [note, setNote] = useState('');
  const shown = depts.filter((d) => d.active || d.weight > 0);
  const total = Math.round(shown.reduce((s, d) => s + (Number(w[d.id]) || 0), 0) * 100) / 100;
  return (
    <div className="space-y-2">
      {shown.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {d.name}
            {!d.active && <span className="text-xs text-muted"> (غير نشطة)</span>}
          </span>
          <Input type="number" step="0.5" min={0} max={100} className="num w-24 text-left" dir="ltr" disabled={!canEdit} value={w[d.id]} onChange={(e) => setW({ ...w, [d.id]: Number(e.target.value) })} aria-label={`وزن ${d.name}`} />
        </div>
      ))}
      <p className={`text-sm ${Math.abs(total - 100) <= 0.01 ? 'text-done' : 'text-late'}`}>المجموع {fmtPct(total)}</p>
      {canEdit && (
        <>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                const act = depts.filter((d) => d.active);
                const each = Math.floor((100 / act.length) * 100) / 100;
                const next = Object.fromEntries(depts.map((d) => [d.id, 0]));
                act.forEach((d, i) => (next[d.id] = i === act.length - 1 ? Math.round((100 - each * (act.length - 1)) * 100) / 100 : each));
                setW(next);
              }}
            >
              توزيع متساوٍ على النشطة
            </Button>
          </div>
          <Input placeholder="سبب التعديل (يحفظ مع الإصدار)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button
            disabled={pending || Math.abs(total - 100) > 0.01}
            onClick={() => run(() => setDeptWeightsAction(year, Object.entries(w).filter(([, v]) => v > 0).map(([department_id, weight]) => ({ department_id, weight })), note))}
          >
            اعتماد إصدار جديد من الأوزان
          </Button>
          <p className="text-xs text-muted">الإصدارات السابقة محفوظة، والتقارير المعتمدة لا يُعاد احتسابها.</p>
        </>
      )}
    </div>
  );
}

export function DepartmentsPanel({ depts, canEdit }: { depts: { id: string; name: string; short_name: string | null; active: boolean; code: string }[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {depts.map((d) => (
          <DeptRow key={d.id} d={d} canEdit={canEdit} />
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => upsertDepartmentAction({ name }), () => setName(''));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم إدارة جديدة" aria-label="اسم إدارة جديدة" />
          <Button disabled={pending || !name.trim()}>إضافة</Button>
        </form>
      )}
      <p className="text-xs text-muted">بعد إضافة إدارة أو تعطيلها، اعتمد إصدارًا جديدًا من أوزان الإدارات.</p>
    </div>
  );
}

function DeptRow({ d, canEdit }: { d: { id: string; name: string; short_name: string | null; active: boolean; code: string }; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [name, setName] = useState(d.name);
  const [short, setShort] = useState(d.short_name ?? '');
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Input className="h-9 flex-1" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} aria-label="اسم الإدارة" />
      <Input className="h-9 w-32" value={short} disabled={!canEdit} onChange={(e) => setShort(e.target.value)} placeholder="الاسم المختصر" aria-label="الاسم المختصر" />
      {!d.active && <Pill tone="nodata">معطلة</Pill>}
      {canEdit && (
        <>
          {(name !== d.name || short !== (d.short_name ?? '')) && (
            <Button className="h-9" disabled={pending} onClick={() => run(() => upsertDepartmentAction({ id: d.id, name, short_name: short }))}>
              حفظ
            </Button>
          )}
          <Button variant="ghost" className="h-9 text-xs" disabled={pending} onClick={() => run(() => toggleDepartmentAction(d.id, !d.active))}>
            {d.active ? 'تعطيل' : 'تفعيل'}
          </Button>
        </>
      )}
    </li>
  );
}

export function WeeksPanel({ year, quarter, weeks, canEdit }: { year: number; quarter: number; weeks: { weekIndex: number; month: number; wom: number; start: string; end: string }[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {weeks.map((w) => (
          <WeekRow key={w.weekIndex} w={w} year={year} quarter={quarter} canEdit={canEdit} />
        ))}
      </div>
      {canEdit && (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => markWeeksReviewedAction(year, quarter))}>
          اعتماد الحدود كما هي
        </Button>
      )}
    </div>
  );
}

function WeekRow({ w, year, quarter, canEdit }: { w: { weekIndex: number; month: number; wom: number; start: string; end: string }; year: number; quarter: number; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [s, setS] = useState(w.start);
  const [e, setE] = useState(w.end);
  const dirty = s !== w.start || e !== w.end;
  return (
    <div className="rounded-lg border border-line p-2">
      <p className="mb-1 text-xs text-muted">
        {MONTHS[w.month]} — الأسبوع {w.wom}
      </p>
      <div className="flex items-center gap-1">
        <Input type="date" className="h-8 text-xs" dir="ltr" value={s} disabled={!canEdit} onChange={(x) => setS(x.target.value)} aria-label="البداية" />
        <Input type="date" className="h-8 text-xs" dir="ltr" value={e} disabled={!canEdit} onChange={(x) => setE(x.target.value)} aria-label="النهاية" />
        {dirty && (
          <Button className="h-8 px-2 text-xs" disabled={pending} onClick={() => run(() => updateWeekAction(year, quarter, w.weekIndex, s, e))}>
            حفظ
          </Button>
        )}
      </div>
    </div>
  );
}

export function StaleSetting({ value }: { value: number }) {
  const { pending, run } = useRun();
  const [v, setV] = useState(value);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSettingAction('stale_after_days', v));
      }}
    >
      <div>
        <Label htmlFor="sd">عدد الأيام</Label>
        <Input id="sd" type="number" min={3} max={60} className="w-24" dir="ltr" value={v} onChange={(e) => setV(Number(e.target.value))} />
      </div>
      <Button disabled={pending}>حفظ</Button>
    </form>
  );
}
