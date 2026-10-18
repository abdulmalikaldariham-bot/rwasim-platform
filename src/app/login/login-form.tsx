'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Input, Label } from '@/components/ui';
import { signIn } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, null as null | { error: string });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <div>
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">كلمة المرور</Label>
          <Link href="/login/forgot" className="text-xs text-teal hover:underline">
            نسيت كلمة المرور؟
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-stalled-soft px-3 py-2 text-sm text-stalled">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'جارٍ الدخول…' : 'دخول'}
      </Button>
    </form>
  );
}
