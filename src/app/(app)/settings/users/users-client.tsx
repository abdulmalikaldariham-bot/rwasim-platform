'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MoreHorizontal, Plus } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { Button, Input, Label, Pill, Select } from '@/components/ui';
import { createUserAction, resetPasswordAction, updateUserAction } from '@/app/actions/settings';
import { ROLE_LABELS } from '@/lib/labels';

const ROLES = ['executive_director', 'dept_manager', 'employee', 'board_member', 'system_admin'];

function AccessNotice({ email, password, link, onClose }: { email: string; password?: string; link?: string; onClose: () => void }) {
  const value = link ?? password ?? '';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={link ? 'رابط التفعيل' : 'كلمة المرور المؤقتة'}
      description={
        link
          ? 'يظهر مرة واحدة. أرسله للمستخدم بطريقة آمنة؛ يُستخدم مرة واحدة لتعيين كلمة مروره بنفسه، وتنتهي صلاحيته بعد مدة محدودة.'
          : 'تظهر مرة واحدة ولا تُحفظ في المنصة. سلّمها للمستخدم بطريقة آمنة؛ سيُطلب منه تغييرها فور دخوله.'
      }
    >
      <p className="text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>
        {email}
      </p>
      <p className={`num mt-2 rounded-lg bg-sunken px-3 py-3 text-center font-bold break-all select-all ${link ? 'text-xs' : 'text-lg'}`} dir="ltr">
        {value}
      </p>
      <Button className="mt-4 w-full" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success('نُسخ'))}>
        نسخ
      </Button>
    </Dialog>
  );
}

export function NewUser({ depts }: { depts: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', full_name: '', role: 'employee', department_id: '', job_title: '', method: 'invite' as 'invite' | 'temp' });
  const [pw, setPw] = useState<{ email: string; password?: string; link?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const needsDept = f.role === 'dept_manager' || f.role === 'employee';
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> مستخدم جديد
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="إضافة مستخدم">
        <div className="space-y-3">
          <div>
            <Label htmlFor="un">الاسم</Label>
            <Input id="un" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ue">البريد</Label>
            <Input id="ue" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ur">الدور</Label>
              <Select id="ur" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ud">الإدارة</Label>
              <Select id="ud" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
                <option value="">{needsDept ? '— اختر —' : 'لا يوجد'}</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-text">طريقة تسليم الحساب</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['invite', 'رابط تفعيل', 'يعيّن المستخدم كلمة مروره بنفسه (موصى به)'],
                  ['temp', 'كلمة مرور مؤقتة', 'فريدة وعشوائية، يغيّرها عند أول دخول'],
                ] as const
              ).map(([k, t, d]) => (
                <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${f.method === k ? 'border-teal bg-teal-soft/50' : 'border-line'}`}>
                  <input type="radio" name="method" checked={f.method === k} onChange={() => setF({ ...f, method: k })} className="mt-1 accent-[var(--teal)]" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{t}</span>
                    <span className="block text-xs text-muted">{d}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="uj" hint="اختياري">المسمى الوظيفي</Label>
            <Input id="uj" value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} />
          </div>
          <Button
            className="w-full"
            disabled={pending || !f.email || !f.full_name || (needsDept && !f.department_id)}
            onClick={() =>
              start(async () => {
                const r = await createUserAction({ ...f, department_id: f.department_id || null });
                if (!r.ok) return void toast.error(r.error);
                setOpen(false);
                setPw({ email: f.email, password: r.password, link: r.link });
                setF({ email: '', full_name: '', role: 'employee', department_id: '', job_title: '', method: 'invite' });
                router.refresh();
              })
            }
          >
            إنشاء الحساب
          </Button>
        </div>
      </Dialog>
      {pw && <AccessNotice {...pw} onClose={() => setPw(null)} />}
    </>
  );
}

export function UserRow({
  u,
  depts,
  self,
}: {
  u: { id: string; full_name: string; email: string | null; role: string; department_id: string | null; is_active: boolean };
  depts: { id: string; name: string }[];
  self: boolean;
}) {
  const [pending, start] = useTransition();
  const [pw, setPw] = useState<{ password?: string; link?: string } | null>(null);
  const router = useRouter();
  const upd = (patch: Parameters<typeof updateUserAction>[1]) =>
    start(async () => {
      const r = await updateUserAction(u.id, patch);
      r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
    });
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-2.5 font-medium">
        {u.full_name}
        {self && <span className="ms-1 text-xs text-muted">(أنت)</span>}
      </td>
      <td className="px-4 py-2.5" dir="ltr" style={{ textAlign: 'right' }}>
        {u.email}
      </td>
      <td className="px-4 py-2.5">
        <select className="h-8 rounded-md border border-line bg-surface px-2 text-xs" value={u.role} disabled={self || pending} onChange={(e) => upd({ role: e.target.value })} aria-label="الدور">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <select className="h-8 max-w-48 rounded-md border border-line bg-surface px-2 text-xs" value={u.department_id ?? ''} disabled={pending} onChange={(e) => upd({ department_id: e.target.value || null })} aria-label="الإدارة">
          <option value="">—</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <Pill tone={u.is_active ? 'done' : 'nodata'}>{u.is_active ? 'نشط' : 'معطل'}</Pill>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {!self && (
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-xs text-teal hover:bg-teal-soft [&::-webkit-details-marker]:hidden">
              <MoreHorizontal size={16} /> إجراءات
            </summary>
            <div className="absolute end-0 z-10 mt-1 flex w-40 flex-col items-stretch rounded-xl border border-line bg-surface p-1 shadow-lg [&>button]:justify-start">
            <Button variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => upd({ is_active: !u.is_active })}>
              {u.is_active ? 'تعطيل' : 'تفعيل'}
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={pending}
              onClick={() =>
                confirm('إنشاء رابط استعادة لهذا المستخدم؟ سيُطلب منه تعيين كلمة مرور جديدة.') &&
                start(async () => {
                  const r = await resetPasswordAction(u.id, 'link');
                  r.ok ? setPw({ link: r.link }) : toast.error(r.error);
                })
              }
            >
              رابط استعادة
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={pending}
              onClick={() =>
                confirm('إنشاء كلمة مرور مؤقتة جديدة؟ ستتوقف كلمة المرور الحالية فورًا.') &&
                start(async () => {
                  const r = await resetPasswordAction(u.id, 'temp');
                  r.ok ? setPw({ password: r.password }) : toast.error(r.error);
                })
              }
            >
              كلمة مؤقتة
            </Button>
            </div>
          </details>
        )}
        {pw && <AccessNotice email={u.email ?? ''} {...pw} onClose={() => setPw(null)} />}
      </td>
    </tr>
  );
}
