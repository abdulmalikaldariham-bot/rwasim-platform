'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label, Textarea } from '@/components/ui';
import { addMeasurementAction } from '@/app/actions/exec';

export function MeasurementForm({ kpiId }: { kpiId: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addMeasurementAction({ kpiId, value: Number(value), measuredOn: date, note });
          if (r.ok) {
            toast.success('سُجل القياس');
            setValue('');
            setNote('');
          } else toast.error(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="mv">القيمة الفعلية</Label>
        <Input id="mv" type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
      </div>
      <div>
        <Label htmlFor="md">تاريخ القياس</Label>
        <Input id="md" type="date" required value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="mn" hint="اختيارية">ملاحظة أو مصدر</Label>
        <Textarea id="mn" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          تسجيل القياس
        </Button>
      </div>
    </form>
  );
}
