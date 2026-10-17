'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Notice, Panel, Pill } from '@/components/ui';
import { FilePicker } from '@/components/file-picker';
import { reimportApplyAction, reimportPreviewAction } from '@/app/actions/plans';
import type { PlanDiff } from '@/lib/import/diff';

const FIELD = { responsible: 'المسؤول', output: 'المخرج', weeks: 'الأسابيع' };

export function ReimportClient({ planId, approved }: { planId: string; approved: boolean }) {
  const [diff, setDiff] = useState<PlanDiff | null>(null);
  const [sheet, setSheet] = useState('');
  const [d, setD] = useState({ applyAdded: true, applyChanged: true, removeMissing: false });
  const [pending, start] = useTransition();
  const router = useRouter();
  const s = diff?.summary;
  return (
    <div className="space-y-5">
      <Notice tone="teal">
        {approved
          ? 'الخطة معتمدة: تحديثات المسؤول والمخرج تطبق مباشرة، أما الإضافة والحذف وتغيير الجدولة فتُرسل كطلب تعديل للمدير التنفيذي. لا يُحذف أي إنجاز مسجل.'
          : 'الخطة مسودة: تطبق التغييرات مباشرة وتعاد موازنة الأوزان لتبقى 100٪. لا تُكرر الأنشطة الموجودة.'}
      </Notice>
      <Panel className="p-5">
        <FilePicker
          label="اختر الملف المحدث"
          busy={pending && !diff}
          onFile={(f) => {
            const fd = new FormData();
            fd.set('file', f);
            fd.set('planId', planId);
            start(async () => {
              const r = await reimportPreviewAction(fd);
              if (r.ok) {
                setDiff(r.diff);
                setSheet(r.sheetName);
              } else toast.error(r.error);
            });
          }}
        />
        {pending && !diff && <p className="mt-3 text-sm text-muted">جارٍ المقارنة…</p>}
      </Panel>
      {diff && s && (
        <>
          <Panel className="p-5">
            <p className="mb-3 text-sm text-muted">الورقة المطابقة: {sheet}</p>
            <div className="flex flex-wrap gap-2">
              <Pill tone="done">{s.addedActivities} نشاط جديد</Pill>
              <Pill tone="done">{s.addedSteps} خطوة جديدة</Pill>
              <Pill tone="teal">{s.changedSteps} خطوة معدلة</Pill>
              <Pill tone="late">{s.removedActivities} نشاط غير موجود في الملف</Pill>
              <Pill tone="late">{s.removedSteps} خطوة غير موجودة في الملف</Pill>
              {s.protectedItems > 0 && <Pill tone="stalled">{s.protectedItems} خطوات بها إنجاز محمية من الحذف</Pill>}
            </div>
          </Panel>
          <div className="space-y-3">
            {diff.activities
              .filter((a) => a.kind !== 'matched' || a.steps.some((x) => x.kind !== 'same'))
              .map((a, i) => (
                <Panel key={i} className="p-4">
                  <p className="font-semibold text-ink">
                    {a.title} {a.kind === 'added' && <Pill tone="done">جديد</Pill>} {a.kind === 'removed' && <Pill tone="late">غير موجود في الملف</Pill>}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {a.steps
                      .filter((x) => x.kind !== 'same')
                      .map((x, k) => (
                        <li key={k} className="flex flex-wrap gap-2">
                          <span className={x.kind === 'added' ? 'text-done' : x.kind === 'removed' ? 'text-late line-through' : ''}>{x.title}</span>
                          {x.hasProgress && x.kind === 'removed' && <span className="text-xs text-stalled">(بها إنجاز — لن تُحذف)</span>}
                          {x.changes.map((c) => (
                            <span key={c.field} className="text-xs text-muted">
                              {FIELD[c.field]}: «{c.from || '—'}» ← «{c.to || '—'}»
                            </span>
                          ))}
                        </li>
                      ))}
                  </ul>
                </Panel>
              ))}
          </div>
          <Panel className="space-y-2 p-5">
            {(
              [
                ['applyAdded', 'إضافة الأنشطة والخطوات الجديدة'],
                ['applyChanged', 'تطبيق التعديلات على الخطوات الموجودة'],
                ['removeMissing', 'إزالة ما لم يعد في الملف (عدا ما فيه إنجاز)'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.checked })} />
                {l}
              </label>
            ))}
            <Button
              className="mt-2"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await reimportApplyAction(planId, diff, d);
                  if (r.ok) {
                    toast.success(r.message);
                    router.push(`/plans/${planId}`);
                  } else toast.error(r.error);
                })
              }
            >
              {approved ? 'تطبيق وإرسال طلب التعديل' : 'تطبيق التغييرات'}
            </Button>
          </Panel>
        </>
      )}
    </div>
  );
}
