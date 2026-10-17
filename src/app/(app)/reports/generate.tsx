'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Input, Label, Select } from '@/components/ui';
import { generateReportAction } from '@/app/actions/reports';
import { MONTHS, QUARTER_LABEL } from '@/lib/labels';

export function GenerateReport({ years, year: y0, quarter: q0, depts, allowOrg }: { years: number[]; year: number; quarter: number; depts: { id: string; name: string }[]; allowOrg: boolean }) {
  const [type, setType] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly');
  const [year, setYear] = useState(y0);
  const [quarter, setQuarter] = useState(q0);
  const [month, setMonth] = useState(Number(new Date().toISOString().slice(5, 7)));
  const [dept, setDept] = useState(allowOrg ? '' : depts[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const label = type === 'monthly' ? `شهر ${MONTHS[month]} ${year}م` : type === 'quarterly' ? `${QUARTER_LABEL[quarter]} ${year}م` : `عام ${year}م`;
  const scope = dept ? depts.find((d) => d.id === dept)?.name : 'جمعية رواسم';
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await generateReportAction({ type, year, quarter, month, departmentId: dept || null, title: title || `تقرير الأداء — ${label} — ${scope}` });
          if (r.ok) {
            toast.success('أُصدر التقرير');
            router.push(`/reports/${r.id}`);
          } else toast.error(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="rt">النوع</Label>
        <Select id="rt" value={type} onChange={(e) => setType(e.target.value as 'monthly')}>
          <option value="monthly">شهري</option>
          <option value="quarterly">ربعي</option>
          <option value="annual">سنوي</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ry">السنة</Label>
          <Select id="ry" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}م
              </option>
            ))}
          </Select>
        </div>
        {type === 'quarterly' && (
          <div>
            <Label htmlFor="rq">الربع</Label>
            <Select id="rq" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  {QUARTER_LABEL[q]}
                </option>
              ))}
            </Select>
          </div>
        )}
        {type === 'monthly' && (
          <div>
            <Label htmlFor="rm">الشهر</Label>
            <Select id="rm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="rd">النطاق</Label>
        <Select id="rd" value={dept} onChange={(e) => setDept(e.target.value)}>
          {allowOrg && <option value="">تقرير شامل للجمعية</option>}
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="rti" hint="اختياري">العنوان</Label>
        <Input id="rti" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`تقرير الأداء — ${label}`} />
      </div>
      <Button className="w-full" disabled={pending}>
        {pending ? 'جارٍ تجميع البيانات…' : 'إصدار التقرير'}
      </Button>
    </form>
  );
}
