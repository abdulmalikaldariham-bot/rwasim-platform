import Link from 'next/link';
import type { DeptEval, OrgEval } from '@/lib/engine/types';
import { DATA_STATE } from '@/lib/labels';
import { fmtPct } from '@/lib/format';
import { Pill, stateTone } from '../ui';

/**
 * «الطبقات»: كل إدارة طبقة أفقية تمتلئ بقدر إنجازها، والعلامة الرأسية تمثل المخطط حتى اليوم.
 * الوزن (20٪) يدخل في الحساب فقط ولا يُعرض.
 */
export function Strata({ org, names, hrefFor }: { org: OrgEval; names: Record<string, string>; hrefFor: (d: DeptEval) => string }) {
  return (
    <ol className="space-y-2.5">
      {org.departments.map((d, i) => {
        const has = d.progress !== null;
        const behind = has && d.planned !== null && d.progress! + 10 < d.planned!;
        const fill = !has ? 'transparent' : d.progress! >= 100 ? 'var(--done)' : behind ? 'var(--orange)' : 'var(--teal)';
        return (
          <li key={d.departmentId}>
            <Link
              href={hrefFor(d)}
              className="group relative block overflow-hidden rounded-lg border border-line bg-sunken transition hover:border-teal"
            >
              {has && (
                <div
                  className="settle absolute inset-y-0 right-0"
                  style={{ width: `${d.progress}%`, background: `color-mix(in oklab, ${fill} 24%, transparent)`, borderBottom: `4px solid ${fill}`, animationDelay: `${i * 80}ms` }}
                />
              )}
              {!has && <div className="strata-bg absolute inset-0 opacity-70" />}
              {has && d.planned !== null && d.planned > 0 && (
                <div className="absolute bottom-0 h-5 w-[3px] rounded-t-full bg-ink" style={{ right: `calc(${Math.min(100, d.planned)}% - 1.5px)` }} title={`المخطط حتى اليوم ${fmtPct(d.planned)}`} />
              )}
              <div className="relative flex min-h-16 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{names[d.departmentId]}</p>
                  <p className="text-xs text-muted">
                    {has ? `${d.activitiesCompleted} من ${d.activitiesTotal} أنشطة مكتملة` : DATA_STATE[d.dataState]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.dataState !== 'ok' && has && <Pill tone={stateTone(d.dataState)}>{DATA_STATE[d.dataState]}</Pill>}
                  {has ? <span className="num text-xl font-bold text-ink">{fmtPct(d.progress)}</span> : <span className="text-sm font-medium text-muted">لا توجد بيانات</span>}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
