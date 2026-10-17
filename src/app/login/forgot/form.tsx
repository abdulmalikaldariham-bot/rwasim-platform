'use client';
import { useActionState } from 'react';
import { Button, Input, Label } from '@/components/ui';
import { requestPasswordReset } from '../actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null as null | { sent?: boolean; error?: string });
  if (state?.sent) {
    return (
      <p role="status" className="rounded-lg bg-done-soft px-3 py-3 text-sm text-done">
        إن كان البريد مسجلًا لدينا فستصلك رسالة خلال دقائق تحتوي رابط الاستعادة. إن لم تصلك، تواصل مع مسؤول النظام ليصدر لك رابطًا.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="fe">البريد الإلكتروني</Label>
        <Input id="fe" name="email" type="email" autoComplete="email" required dir="ltr" />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-stalled-soft px-3 py-2 text-sm text-stalled">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'جارٍ الإرسال…' : 'إرسال رابط الاستعادة'}
      </Button>
    </form>
  );
}
