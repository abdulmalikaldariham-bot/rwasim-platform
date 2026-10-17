'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, Input, Label, Notice } from '@/components/ui';
import { requestPasswordResetAction } from '@/app/actions/settings';

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return msg ? (
    <div className="space-y-4">
      <Notice tone="done">{msg}</Notice>
      <Link href="/login" className="block text-center text-sm text-teal underline">
        العودة لتسجيل الدخول
      </Link>
    </div>
  ) : (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestPasswordResetAction(email);
          if (r.ok) setMsg(r.message ?? '');
          else setErr(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="fe">البريد الإلكتروني</Label>
        <Input id="fe" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {err && <p className="text-sm text-stalled">{err}</p>}
      <Button className="w-full" disabled={pending || !email}>
        إرسال رابط الاستعادة
      </Button>
      <Link href="/login" className="block text-center text-sm text-muted hover:text-teal">
        العودة لتسجيل الدخول
      </Link>
    </form>
  );
}
