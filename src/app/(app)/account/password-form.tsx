'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@/components/ui';
import { changeOwnPasswordAction } from '@/app/actions/settings';

export function PasswordForm() {
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
          const r = await changeOwnPasswordAction(a);
          r.ok ? (toast.success(r.message), setA(''), setB('')) : toast.error(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="p1">كلمة المرور الجديدة</Label>
        <Input id="p1" type="password" dir="ltr" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="p2">تأكيدها</Label>
        <Input id="p2" type="password" dir="ltr" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      <Button disabled={pending || a.length < 10}>تغيير كلمة المرور</Button>
    </form>
  );
}
