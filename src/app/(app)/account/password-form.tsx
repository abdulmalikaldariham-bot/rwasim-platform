'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@/components/ui';
import { changeOwnPasswordAction } from '@/app/actions/settings';

export function PasswordForm() {
  const [cur, setCur] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (a !== b) return void toast.error('كلمتا المرور غير متطابقتين');
        start(async () => {
          const r = await changeOwnPasswordAction(cur, a);
          if (r.ok) {
            toast.success(r.message);
            setCur('');
            setA('');
            setB('');
          } else toast.error(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="p0">كلمة المرور الحالية</Label>
        <Input id="p0" type="password" dir="ltr" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="p1" hint="10 أحرف على الأقل، حروف وأرقام">
          كلمة المرور الجديدة
        </Label>
        <Input id="p1" type="password" dir="ltr" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="p2">تأكيدها</Label>
        <Input id="p2" type="password" dir="ltr" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required />
        {b && a !== b && <p className="mt-1 text-xs text-stalled">غير متطابقتين</p>}
      </div>
      <Button disabled={pending || !cur || a.length < 10 || a !== b}>{pending ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'}</Button>
    </form>
  );
}
