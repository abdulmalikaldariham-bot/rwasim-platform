'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog } from '@/components/dialog';
import { Button, Label, Select } from '@/components/ui';
import { createManualPlanAction } from '@/app/actions/plans';
import { QUARTER_LABEL } from '@/lib/labels';

export function NewPlanButton({ year, quarter, depts }: { year: number; quarter: number; depts: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(quarter);
  const [dept, setDept] = useState(depts[0]?.id ?? '');
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        إنشاء يدوي
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="خطة تشغيلية جديدة" description={`سنة ${year}م`}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="nq">الربع</Label>
            <Select id="nq" value={q} onChange={(e) => setQ(Number(e.target.value))}>
              {[1, 2, 3, 4].map((x) => (
                <option key={x} value={x}>
                  {QUARTER_LABEL[x]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="nd">الإدارة</Label>
            <Select id="nd" value={dept} onChange={(e) => setDept(e.target.value)}>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            className="w-full"
            disabled={pending || !dept}
            onClick={() =>
              start(async () => {
                const r = await createManualPlanAction({ year, quarter: q, departmentId: dept });
                if (r.ok) router.push(`/plans/${r.id}`);
                else toast.error(r.error);
              })
            }
          >
            إنشاء المسودة
          </Button>
        </div>
      </Dialog>
    </>
  );
}
