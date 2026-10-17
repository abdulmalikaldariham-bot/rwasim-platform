'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, KeyRound, Link2, Plus } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { Avatar, Button, Input, Label, Pill, Select } from '@/components/ui';
import { createUserAction, resetPasswordAction, updateUserAction, type Credential } from '@/app/actions/settings';
import { ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/format';

const ROLES = ['employee', 'dept_manager', 'executive_director', 'board_member', 'system_admin'];
const ROLE_HINT: Record<string, string> = {
  employee: 'يرى مهامه المسندة ويحدثها',
  dept_manager: 'يدير خطة إدارته ومهامها وموظفيها',
  executive_director: 'كل الصلاحيات والاعتمادات',
  board_member: 'قراءة الخطط والتقارير المعتمدة',
  system_admin: 'المستخدمون والإعدادات الفنية',
};

const copy = (t: string, msg = 'نُسخ') =>
  navigator.clipboard.writeText(t).then(
    () => toast.success(msg),
    () => prompt('انسخ النص', t),
  );

function CredentialNotice({ name, email, cred, onClose }: { name: string; email: string; cred: Credential; onClose: () => void }) {
  const message =
    cred.kind === 'link'
      ? `مرحبًا ${name}،\nأُنشئ لك حساب في منصة الأداء المؤسسي لجمعية رواسم.\nافتح الرابط التالي لتعيين كلمة المرور (صالح لمرة واحدة ولفترة محدودة):\n${cred.link}\nبريد الدخول: ${email}`
      : `مرحبًا ${name}،\nبيانات دخولك إلى منصة الأداء المؤسسي لجمعية رواسم:\nالبريد: ${email}\nكلمة المرور المؤقتة: ${cred.password}\nسيُطلب منك تعيين كلمة مرور جديدة عند أول دخول.`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={cred.kind === 'link' ? 'رابط إعداد الحساب' : 'كلمة المرور المؤقتة'}
      description="تظهر مرة واحدة فقط. أرسلها للمستخدم بطريقة آمنة (مثل رسالة مباشرة)."
    >
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-semibold">{name}</span> · <span dir="ltr">{email}</span>
        </p>
        {cred.kind === 'link' ? (
          <code dir="ltr" className="block max-h-24 overflow-y-auto rounded-2xl bg-sunken px-3 py-2 text-xs break-all select-all">
            {cred.link}
          </code>
        ) : (
          <p className="num rounded-2xl bg-sunken px-3 py-3 text-center text-xl font-bold tracking-wide select-all">{cred.password}</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => copy(cred.kind === 'link' ? cred.link : cred.password)}>
            <Copy size={15} /> {cred.kind === 'link' ? 'نسخ الرابط' : 'نسخ كلمة المرور'}
          </Button>
          <Button onClick={() => copy(message, 'نُسخت رسالة جاهزة للإرسال')}>
            <Copy size={15} /> نسخ رسالة جاهزة
          </Button>
        </div>
        <p className="text-xs text-muted">
          {cred.kind === 'link'
            ? 'الرابط صالح لمرة واحدة ولمدة محدودة (ساعة افتراضيًا). إن انتهى أنشئ رابطًا جديدًا من «إعادة تعيين».'
            : 'كلمة المرور فريدة لهذا المستخدم ولا تُحفظ نصًا صريحًا، وسيُلزم بتغييرها عند أول دخول.'}
        </p>
      </div>
    </Dialog>
  );
}

export function NewUser({ depts }: { depts: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const empty = { email: '', full_name: '', role: 'employee', department_id: '', job_title: '', method: 'link' as 'link' | 'password' };
  const [f, setF] = useState(empty);
  const [cred, setCred] = useState<{ name: string; email: string; cred: Credential } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const needsDept = f.role === 'dept_manager' || f.role === 'employee';
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Plus size={16} /> مستخدم جديد
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="إضافة مستخدم" description="أدخل البيانات الأساسية؛ وسيعين المستخدم كلمة مروره بنفسه.">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="un">الاسم</Label>
              <Input id="un" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus />
            </div>
            <div>
              <Label htmlFor="ue">البريد الإلكتروني</Label>
              <Input id="ue" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">الدور والصلاحيات</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLES.map((r) => (
                <label key={r} className={cn('flex cursor-pointer gap-2 rounded-2xl border p-2.5', f.role === r ? 'border-teal bg-teal-soft/50' : 'border-line hover:bg-sunken')}>
                  <input type="radio" name="role" className="mt-1 accent-[var(--teal)]" checked={f.role === r} onChange={() => setF({ ...f, role: r })} />
                  <span>
                    <span className="block text-sm font-semibold">{ROLE_LABELS[r]}</span>
                    <span className="block text-xs text-muted">{ROLE_HINT[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ud" hint={needsDept ? 'مطلوبة' : 'اختيارية'}>
                الإدارة
              </Label>
              <Select id="ud" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
                <option value="">{needsDept ? '— اختر —' : 'لا يوجد'}</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="uj" hint="اختياري">المسمى الوظيفي</Label>
              <Input id="uj" value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">طريقة الدخول الأول</legend>
            <div className="flex rounded-full border border-line bg-sunken p-1 text-sm">
              <button type="button" onClick={() => setF({ ...f, method: 'link' })} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5', f.method === 'link' && 'bg-surface font-semibold shadow-card')}>
                <Link2 size={14} /> رابط إعداد (موصى به)
              </button>
              <button type="button" onClick={() => setF({ ...f, method: 'password' })} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5', f.method === 'password' && 'bg-surface font-semibold shadow-card')}>
                <KeyRound size={14} /> كلمة مرور مؤقتة
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {f.method === 'link' ? 'يفتح المستخدم الرابط ويعين كلمة مروره بنفسه؛ لا يطلع أحد عليها.' : 'كلمة مرور فريدة قوية يُلزم المستخدم بتغييرها عند أول دخول.'}
            </p>
          </fieldset>
          <Button
            className="w-full"
            disabled={pending || !f.email || !f.full_name || (needsDept && !f.department_id)}
            onClick={() =>
              start(async () => {
                const r = await createUserAction({ ...f, department_id: f.department_id || null });
                if (!r.ok) return void toast.error(r.error);
                setOpen(false);
                setCred({ name: f.full_name, email: f.email.trim().toLowerCase(), cred: r.credential });
                setF(empty);
                router.refresh();
              })
            }
          >
            {pending ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
          </Button>
        </div>
      </Dialog>
      {cred && <CredentialNotice {...cred} onClose={() => setCred(null)} />}
    </>
  );
}

export function UserRow({
  u,
  depts,
  self,
}: {
  u: { id: string; full_name: string; email: string | null; role: string; department_id: string | null; is_active: boolean; must_change_password?: boolean; job_title?: string | null };
  depts: { id: string; name: string }[];
  self: boolean;
}) {
  const [pending, start] = useTransition();
  const [cred, setCred] = useState<Credential | null>(null);
  const router = useRouter();
  const upd = (patch: Parameters<typeof updateUserAction>[1]) =>
    start(async () => {
      const r = await updateUserAction(u.id, patch);
      r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
    });
  const reset = (method: 'link' | 'password') =>
    start(async () => {
      const r = await resetPasswordAction(u.id, method);
      if (r.ok) {
        setCred(r.credential);
        router.refresh();
      } else toast.error(r.error);
    });
  const sel = 'h-8 rounded-full border border-line bg-surface px-3 text-xs';
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3">
        <span className="flex items-center gap-2.5">
          <Avatar name={u.full_name || '؟'} size={32} />
          <span>
            <span className="block font-semibold">
              {u.full_name}
              {self && <span className="ms-1 text-xs font-normal text-muted">(أنت)</span>}
            </span>
            <span className="block text-xs text-muted" dir="ltr" style={{ textAlign: 'right' }}>
              {u.email}
            </span>
          </span>
        </span>
      </td>
      <td className="px-4 py-3">
        <select className={sel} value={u.role} disabled={self || pending} onChange={(e) => upd({ role: e.target.value })} aria-label="الدور">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <select className={cn(sel, 'max-w-48')} value={u.department_id ?? ''} disabled={pending} onChange={(e) => upd({ department_id: e.target.value || null })} aria-label="الإدارة">
          <option value="">—</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <span className="flex flex-wrap gap-1">
          <Pill tone={u.is_active ? 'done' : 'nodata'}>{u.is_active ? 'نشط' : 'معطل'}</Pill>
          {u.is_active && u.must_change_password && <Pill tone="late">بانتظار تعيين كلمة المرور</Pill>}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {!self && (
          <span className="flex gap-1">
            <Button variant="ghost" className="h-8 px-3 text-xs" disabled={pending} onClick={() => upd({ is_active: !u.is_active })}>
              {u.is_active ? 'تعطيل' : 'تفعيل'}
            </Button>
            <Button variant="ghost" className="h-8 px-3 text-xs" disabled={pending || !u.is_active} onClick={() => confirm('إنشاء رابط جديد لتعيين كلمة المرور؟ يبطل الرابط السابق.') && reset('link')}>
              <Link2 size={13} /> رابط تعيين
            </Button>
            <Button variant="ghost" className="h-8 px-3 text-xs" disabled={pending || !u.is_active} onClick={() => confirm('إنشاء كلمة مرور مؤقتة جديدة؟ تُلغى كلمة المرور الحالية.') && reset('password')}>
              <KeyRound size={13} /> مؤقتة
            </Button>
          </span>
        )}
        {cred && <CredentialNotice name={u.full_name} email={u.email ?? ''} cred={cred} onClose={() => setCred(null)} />}
      </td>
    </tr>
  );
}
