'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ACTIVITY_STATE } from '@/lib/labels';

export function ActivityFilters({ depts, showWeights }: { depts: { id: string; name: string }[]; showWeights: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [s, setS] = useState(sp.get('s') ?? '');
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.push(`${path}?${p}`);
  };
  const sel = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set('s', s.trim() || null);
        }}
        className="flex-1 sm:max-w-xs"
      >
        <input value={s} onChange={(e) => setS(e.target.value)} placeholder="ابحث في الأنشطة والخطوات والمسؤولين" className={`${sel} w-full px-3`} aria-label="بحث" />
      </form>
      {depts.length > 0 && (
        <select className={sel} value={sp.get('dept') ?? ''} onChange={(e) => set('dept', e.target.value || null)} aria-label="الإدارة">
          <option value="">كل الإدارات</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      <select className={sel} value={sp.get('state') ?? ''} onChange={(e) => set('state', e.target.value || null)} aria-label="الحالة">
        <option value="">كل الحالات</option>
        {(['stalled', 'late', 'in_progress', 'not_started', 'completed'] as const).map((k) => (
          <option key={k} value={k}>
            {ACTIVITY_STATE[k]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={showWeights} onChange={(e) => set('weights', e.target.checked ? '1' : null)} />
        إظهار الأوزان
      </label>
    </div>
  );
}
