'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function WorkspaceFilters({ people, who }: { people: string[]; who: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      المسؤول
      <select
        className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-text"
        value={who ?? ''}
        onChange={(e) => {
          const p = new URLSearchParams(sp.toString());
          if (e.target.value) p.set('who', e.target.value);
          else p.delete('who');
          router.push(`${path}?${p}`);
        }}
      >
        <option value="">الجميع</option>
        {people.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}
