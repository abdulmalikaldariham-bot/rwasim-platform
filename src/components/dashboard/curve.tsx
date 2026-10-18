'use client';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CurvePoint } from '@/lib/engine/progress';

export function CurveChart({ data, height = 260, big = false }: { data: CurvePoint[]; height?: number | string; big?: boolean }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">لا توجد خطط معتمدة لهذا الربع.</p>;
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" reversed tick={{ fill: 'var(--muted)', fontSize: big ? 14 : 11, fontFamily: 'IBM Plex Sans Arabic' }} interval="preserveStartEnd" minTickGap={18} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis orientation="right" domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: big ? 14 : 11 }} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'IBM Plex Sans Arabic', direction: 'rtl' }}
            formatter={(v, n) => [`${v}%`, n === 'planned' ? 'المخطط' : 'المتحقق']}
          />
          <Legend formatter={(v) => (v === 'planned' ? 'المخطط' : 'المتحقق')} wrapperStyle={{ fontFamily: 'IBM Plex Sans Arabic', fontSize: big ? 15 : 13 }} />
          <Line type="monotone" dataKey="planned" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" stroke={big ? 'var(--orange)' : 'var(--teal)'} strokeWidth={big ? 4 : 3} dot={{ r: big ? 4 : 3, fill: big ? 'var(--orange)' : 'var(--teal)' }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
