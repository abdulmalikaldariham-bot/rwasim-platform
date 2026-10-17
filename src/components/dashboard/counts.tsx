import Link from 'next/link';
import { FolderKanban, ListChecks } from 'lucide-react';
import type { DeptEval } from '@/lib/engine/types';

export interface UnitCounts {
  units: number;
  projects: number;
  unitsCompleted: number;
  unitsInProgress: number;
  unitsLate: number;
  unitsNotStarted: number;
  steps: number;
  stepsCompleted: number;
  stepsInProgress: number;
  stepsLate: number;
}

/** تجميع العدادات من تقييمات الإدارات — المشاريع والأنشطة منفصلة عن المهام التنفيذية */
export function countUnits(depts: DeptEval[]): UnitCounts {
  const ok = depts.filter((d) => d.progress !== null);
  const s = (k: keyof DeptEval) => ok.reduce((n, d) => n + (Number(d[k]) || 0), 0);
  return {
    units: s('activitiesTotal'),
    projects: s('projectsTotal'),
    unitsCompleted: s('activitiesCompleted'),
    unitsInProgress: s('activitiesInProgress'),
    unitsLate: s('activitiesLate') + s('activitiesStalled'),
    unitsNotStarted: s('activitiesNotStarted'),
    steps: s('stepsTotal'),
    stepsCompleted: s('stepsCompleted'),
    stepsInProgress: s('stepsInProgress'),
    stepsLate: s('stepsLate'),
  };
}

function Cell({ label, value, color, href }: { label: string; value: number; color?: string; href?: string }) {
  const inner = (
    <>
      <span className="num block text-2xl leading-tight font-bold" style={{ color: color ?? 'var(--ink)', textAlign: 'right' }}>
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl px-2 py-1 transition hover:bg-sunken">
      {inner}
    </Link>
  ) : (
    <div className="px-2 py-1">{inner}</div>
  );
}

/** لوحتان مستقلتان: «المشاريع والأنشطة» و«المهام التنفيذية» — لا يُدمج عددهما في مؤشر واحد */
export function CountsPanel({ c, activitiesHref }: { c: UnitCounts; activitiesHref?: (state: string) => string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <FolderKanban size={17} className="text-orange" /> المشاريع والأنشطة
          <span className="text-xs font-normal text-muted">وحدات العمل في الخطة التشغيلية{c.projects ? ` · منها ${c.projects} مشاريع` : ''}</span>
        </p>
        <div className="grid grid-cols-5 gap-1">
          <Cell label="الإجمالي" value={c.units} href={activitiesHref?.('')} />
          <Cell label="مكتملة" value={c.unitsCompleted} color="var(--done)" href={activitiesHref?.('completed')} />
          <Cell label="جارية" value={c.unitsInProgress} color="var(--teal)" href={activitiesHref?.('in_progress')} />
          <Cell label="متأخرة" value={c.unitsLate} color={c.unitsLate ? 'var(--late)' : undefined} href={activitiesHref?.('late')} />
          <Cell label="لم تبدأ" value={c.unitsNotStarted} color="var(--nodata)" href={activitiesHref?.('not_started')} />
        </div>
      </div>
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <ListChecks size={17} className="text-orange" /> المهام التنفيذية
          <span className="text-xs font-normal text-muted">داخل المشاريع والأنشطة</span>
        </p>
        <div className="grid grid-cols-4 gap-1">
          <Cell label="الإجمالي" value={c.steps} />
          <Cell label="مكتملة" value={c.stepsCompleted} color="var(--done)" />
          <Cell label="جارية" value={c.stepsInProgress} color="var(--teal)" />
          <Cell label="متأخرة" value={c.stepsLate} color={c.stepsLate ? 'var(--late)' : undefined} />
        </div>
      </div>
    </div>
  );
}
