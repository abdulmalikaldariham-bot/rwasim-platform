'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@/components/ui';
import { setNewPasswordAction } from '@/app/actions/settings';
import { passwordProblem } from '@/lib/password';

export function SetPasswordForm({ home, email }: { home: string; email: string }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hint = a ? passwordProblem(a, email) : null;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (a !== b) return setErr('كلمتا المرور غير متطابقتين');
        start(async () => {
          const r = await setNewPasswordAction(a);
          if (!r.ok) return setErr(r.error);
          toast.success(r.message);
          window.location.assign(home);
        });
      }}
    >
      <div>
        <Label htmlFor="np1" hint="10 أحرف على الأقل، حروف وأرقام">
          كلمة المرور الجديدة
        </Label>
        <Input id="np1" type="password" dir="ltr" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required autoFocus />
        {hint && <p className="mt-1 text-xs text-late">{hint}</p>}
      </div>
      <div>
        <Label htmlFor="np2">تأكيد كلمة المرور</Label>
        <Input id="np2" type="password" dir="ltr" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required />
      </div>
      {err && (
        <p role="alert" className="rounded-lg bg-stalled-soft px-3 py-2 text-sm text-stalled">
          {err}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending || !!hint || !a || a !== b}>
        {pending ? 'جارٍ الحفظ…' : 'حفظ والمتابعة'}
      </Button>
    </form>
  );
}
