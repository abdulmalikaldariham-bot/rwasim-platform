'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { Button, Input, Label, Pill, Select, Textarea } from '@/components/ui';
import { createDirectiveAction, resolveEscalationAction, updateDirectiveAction } from '@/app/actions/directives';
import { DIRECTIVE_STATUS } from '@/lib/labels';

export function DirectiveForm({
  depts,
  people,
  activities,
  kpis,
}: {
  depts: { id: string; name: string }[];
  people: { id: string; name: string; dept: string | null }[];
  activities: { id: string; title: string; dept: string }[];
  kpis: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [f, setF] = useState({ title: '', body: '', target_type: 'department' as 'general' | 'department' | 'activity' | 'kpi', department_id: '', activity_id: '', kpi_id: '', assignee_id: '', due_date: '' });
  const deptOfTarget = f.target_type === 'department' ? f.department_id : f.target_type === 'activity' ? activities.find((a) => a.id === f.activity_id)?.dept : '';
  const assignees = deptOfTarget ? people.filter((p) => p.dept === deptOfTarget || !p.dept) : people;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> توجيه جديد
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="توجيه أو ملاحظة" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="dt">التوجيه</Label>
            <Input id="dt" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="db" hint="اختيارية">تفاصيل</Label>
            <Textarea id="db" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="dtt">مرتبط بـ</Label>
            <Select id="dtt" value={f.target_type} onChange={(e) => setF({ ...f, target_type: e.target.value as 'general' })}>
              <option value="department">إدارة</option>
              <option value="activity">نشاط</option>
              <option value="kpi">مؤشر</option>
              <option value="general">عام</option>
            </Select>
          </div>
          <div>
            {f.target_type === 'department' && (
              <>
                <Label htmlFor="dd">الإدارة</Label>
                <Select id="dd" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
                  <option value="">—</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {f.target_type === 'activity' && (
              <>
                <Label htmlFor="da">النشاط</Label>
                <Select id="da" value={f.activity_id} onChange={(e) => setF({ ...f, activity_id: e.target.value })}>
                  <option value="">—</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {f.target_type === 'kpi' && (
              <>
                <Label htmlFor="dk">المؤشر</Label>
                <Select id="dk" value={f.kpi_id} onChange={(e) => setF({ ...f, kpi_id: e.target.value })}>
                  <option value="">—</option>
                  {kpis.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="dp">المسؤول عن المعالجة</Label>
            <Select id="dp" value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
              <option value="">—</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ddd">الموعد المتوقع للمعالجة</Label>
            <Input id="ddd" type="date" dir="ltr" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={pending || !f.title.trim()}
          onClick={() =>
            start(async () => {
              const deptId = f.target_type === 'department' ? f.department_id : f.target_type === 'activity' ? activities.find((a) => a.id === f.activity_id)?.dept ?? null : null;
              const r = await createDirectiveAction({ ...f, department_id: deptId });
              if (r.ok) {
                toast.success(r.message);
                setOpen(false);
                setF({ ...f, title: '', body: '' });
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          حفظ التوجيه
        </Button>
      </Dialog>
    </>
  );
}

export function DirectiveRow({
  d,
}: {
  d: {
    id: string;
    title: string;
    body: string | null;
    target: string;
    assignee: string;
    created: string;
    due: string;
    overdue: boolean;
    status: 'open' | 'in_progress' | 'closed';
    last: { note: string | null } | null;
    updatedAt: string;
  };
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (status: 'open' | 'in_progress' | 'closed') =>
    start(async () => {
      const note = status === 'closed' ? prompt('ملاحظة الإغلاق (اختيارية)') ?? '' : '';
      const r = await updateDirectiveAction(d.id, status, note);
      r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
    });
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium">{d.title}</p>
        {d.body && <p className="text-xs text-muted">{d.body}</p>}
      </td>
      <td className="px-4 py-3">{d.target}</td>
      <td className="px-4 py-3">{d.assignee}</td>
      <td className="px-4 py-3 whitespace-nowrap">{d.created}</td>
      <td className={`px-4 py-3 whitespace-nowrap ${d.overdue ? 'font-semibold text-late' : ''}`}>{d.due}</td>
      <td className="px-4 py-3">
        <Pill tone={d.status === 'closed' ? 'done' : d.overdue ? 'late' : d.status === 'in_progress' ? 'teal' : 'nodata'}>{DIRECTIVE_STATUS[d.status]}</Pill>
      </td>
      <td className="px-4 py-3 text-xs text-muted">
        {d.updatedAt}
        {d.last?.note && <span className="block text-text">{d.last.note}</span>}
      </td>
      <td className="px-4 py-3">
        {d.status !== 'closed' ? (
          <Button variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => act('closed')}>
            إغلاق
          </Button>
        ) : (
          <Button variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => act('open')}>
            إعادة فتح
          </Button>
        )}
      </td>
    </tr>
  );
}

export function EscalationResolve({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      className="h-8 shrink-0 px-3 text-xs"
      disabled={pending}
      onClick={() => {
        const res = prompt('القرار أو التوجيه');
        if (res === null) return;
        start(async () => {
          const r = await resolveEscalationAction(id, res);
          r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
        });
      }}
    >
      تسجيل القرار
    </Button>
  );
}
