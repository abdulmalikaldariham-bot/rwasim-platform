'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button, Input, Label } from '@/components/ui';
import { changeOwnPasswordAction } from '@/app/actions/settings';
import { cn } from '@/lib/format';

export function passwordChecks(p: string) {
  return [
    ['10 أحرف على الأقل', p.length >= 10],
    ['أحرف وأرقام معًا', /[A-Za-z؀-ۿ]/.test(p) && /\d/.test(p)],
  ] as const;
}

export function SetPasswordForm({ home, email }: { home: string; email: string }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const checks = passwordChecks(a);
  const ok = checks.every(([, v]) => v) && a === b;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await changeOwnPasswordAction(a);
          if (!r.ok) return void toast.error(r.error);
          toast.success('عُينت كلمة المرور');
          router.replace(home);
        });
      }}
    >
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <div>
        <Label htmlFor="p1">كلمة المرور الجديدة</Label>
        <Input id="p1" type="password" dir="ltr" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
      </div>
      <ul className="space-y-1 text-xs">
        {checks.map(([l, v]) => (
          <li key={l} className={cn('flex items-center gap-1.5', v ? 'text-done' : 'text-muted')}>
            {v ? <Check size={13} /> : <X size={13} />} {l}
          </li>
        ))}
      </ul>
      <div>
        <Label htmlFor="p2">تأكيد كلمة المرور</Label>
        <Input id="p2" type="password" dir="ltr" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        {b && a !== b && <p className="mt-1 text-xs text-late">غير متطابقتين</p>}
      </div>
      <Button className="w-full" disabled={pending || !ok}>
        {pending ? 'جارٍ الحفظ…' : 'حفظ والدخول إلى المنصة'}
      </Button>
    </form>
  );
}
