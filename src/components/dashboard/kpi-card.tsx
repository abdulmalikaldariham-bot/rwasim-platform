import Link from 'next/link';
import type { KpiView } from '@/lib/data/kpis';
import { KPI_STATUS } from '@/lib/labels';
import { fmtNum, fmtPct } from '@/lib/format';
import { Pill, ProgressBar, stateTone } from '../ui';

export function KpiCard({ kpi, dept, href }: { kpi: KpiView; dept: string; href: string }) {
  const e = kpi.evaluation;
  const tone = stateTone(e.status);
  const unit = kpi.unit ? ` ${kpi.unit}` : kpi.kpi_type === 'percentage' ? '٪' : '';
  return (
    <Link href={href} className="block card p-4 transition hover:border-teal">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-snug text-ink">{kpi.name}</p>
        <Pill tone={tone}>{KPI_STATUS[e.status]}</Pill>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {dept}
        {kpi.direction === 'decrease' ? ' — الانخفاض تحسن' : ''}
      </p>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-xs text-muted">المتحقق</p>
          <p className="num text-xl font-bold text-ink" style={{ textAlign: 'right' }}>
            {kpi.actual === null ? '—' : fmtNum(kpi.actual)}
            <span className="text-sm font-normal text-muted">{kpi.actual === null ? '' : unit}</span>
          </p>
        </div>
        <div className="text-left">
          <p className="text-xs text-muted">المستهدف السنوي</p>
          <p className="num font-semibold text-text">
            {fmtNum(kpi.annual_target)}
            <span className="text-sm font-normal text-muted">{unit}</span>
          </p>
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={e.achievement === null ? null : Math.min(100, Math.max(0, e.achievement))} tone={tone === 'nodata' ? 'teal' : tone} label="نسبة التحقق" />
        <p className="mt-1.5 text-xs text-muted">
          نسبة التحقق <span className="num font-semibold text-text">{fmtPct(e.achievement)}</span>
          {e.expected !== null && (
            <>
              {' '}— المتوقع حتى الربع الحالي <span className="num">{fmtNum(e.expected)}</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
