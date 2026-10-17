'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QUARTER_LABEL } from '@/lib/labels';

export function PeriodPicker({ years, year, quarter, showQuarter = true }: { years: number[]; year: number; quarter?: number; showQuarter?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const go = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.push(`${path}?${p.toString()}`);
  };
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="السنة"
        className="h-10 rounded-lg border border-line bg-surface px-3 text-sm"
        value={year}
        onChange={(e) => go('year', e.target.value)}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}م
          </option>
        ))}
      </select>
      {showQuarter && (
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="الربع">
          {[1, 2, 3, 4].map((q) => (
            <button
              key={q}
              onClick={() => go('q', String(q))}
              aria-pressed={q === quarter}
              title={QUARTER_LABEL[q]}
              className={`h-9 rounded-md px-3 text-sm ${q === quarter ? 'bg-teal font-semibold text-white dark:text-[#04141b]' : 'text-muted hover:text-text'}`}
            >
              ر{q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
