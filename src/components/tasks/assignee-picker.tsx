'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Crown, Search, UserPlus, Users } from 'lucide-react';
import { Dialog } from '../dialog';
import { Avatar, Button, Input } from '../ui';
import { setAssigneesAction } from '@/app/actions/steps';
import { cn } from '@/lib/format';

export interface Person {
  id: string;
  name: string;
  sub?: string;
  inDept: boolean;
}

/** اختيار المكلفين بالمهمة: بحث، تعدد، الجميع، مسؤول رئيسي، ونمط الإنجاز */
export function AssigneePicker({
  stepId,
  people,
  current,
  hasSubsteps,
  trigger = 'button',
}: {
  stepId: string;
  people: Person[];
  current: { userIds: string[]; leadId: string | null; mode: 'collaborative' | 'individual'; threshold: number; allDept: boolean };
  hasSubsteps: boolean;
  trigger?: 'button' | 'link';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(current.userIds);
  const [lead, setLead] = useState<string | null>(current.leadId);
  const [mode, setMode] = useState(current.mode);
  const [threshold, setThreshold] = useState(current.threshold);
  const [allDept, setAllDept] = useState(current.allDept);
  const [pending, start] = useTransition();
  const router = useRouter();
  const deptIds = people.filter((p) => p.inDept).map((p) => p.id);

  const shown = useMemo(() => {
    const n = q.trim();
    return people.filter((p) => !n || p.name.includes(n) || p.sub?.includes(n)).sort((a, b) => Number(sel.includes(b.id)) - Number(sel.includes(a.id)) || Number(b.inDept) - Number(a.inDept));
  }, [q, people, sel]);

  const toggle = (id: string) => {
    setAllDept(false);
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    if (lead === id) setLead(null);
  };
  const selectAll = () => {
    setAllDept(true);
    setSel(deptIds);
    if (mode === 'collaborative' && deptIds.length > 3) setMode('individual');
  };

  const save = () =>
    start(async () => {
      const r = await setAssigneesAction({ stepId, userIds: sel, leadId: lead, mode, threshold, allDept });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {trigger === 'button' ? (
        <Button variant="secondary" className="h-9 px-4" onClick={() => setOpen(true)}>
          <UserPlus size={16} /> {current.userIds.length ? 'تعديل المكلفين' : 'إسناد المهمة'}
        </Button>
      ) : (
        <button className="text-sm font-semibold text-teal hover:underline" onClick={() => setOpen(true)}>
          {current.userIds.length ? 'تعديل' : 'إسناد'}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="المكلفون بالمهمة" description="اختر شخصًا أو أكثر من المستخدمين المخولين" wide>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-56 flex-1">
              <Search size={16} className="pointer-events-none absolute inset-y-0 right-3 my-auto text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم" className="pe-9" aria-label="بحث عن مستخدم" />
            </div>
            <Button variant={allDept ? 'primary' : 'secondary'} className="h-10" onClick={selectAll} disabled={!deptIds.length}>
              <Users size={16} /> جميع موظفي الإدارة ({deptIds.length})
            </Button>
            {sel.length > 0 && (
              <Button variant="ghost" className="h-10" onClick={() => (setSel([]), setLead(null), setAllDept(false))}>
                إلغاء الكل
              </Button>
            )}
          </div>

          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
            {shown.length === 0 && <li className="p-4 text-center text-sm text-muted">لا نتائج</li>}
            {shown.map((p) => {
              const on = sel.includes(p.id);
              return (
                <li key={p.id} className={cn('flex items-center gap-3 rounded-xl px-2.5 py-2', on ? 'bg-teal-soft' : 'hover:bg-sunken')}>
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={on} onChange={() => toggle(p.id)} />
                    <Avatar name={p.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      {p.sub && <span className="block truncate text-xs text-muted">{p.sub}</span>}
                    </span>
                  </label>
                  {on && sel.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLead(lead === p.id ? null : p.id)}
                      aria-pressed={lead === p.id}
                      className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', lead === p.id ? 'bg-orange font-bold text-[#2b1700]' : 'text-muted hover:bg-surface')}
                    >
                      <Crown size={13} /> {lead === p.id ? 'المسؤول الرئيسي' : 'تعيين مسؤولًا'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {sel.length > 1 && (
            <fieldset className="rounded-2xl bg-sunken/70 p-4">
              <legend className="sr-only">نمط الإنجاز</legend>
              <p className="mb-2 text-sm font-semibold">كيف يُحتسب إنجاز المهمة؟</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['collaborative', 'تعاونية', 'يعمل الجميع على مهمة واحدة، وسجل إنجاز مشترك واحد.'],
                    ['individual', 'فردية لكل مكلف', 'يسجل كل شخص إنجازه، وتكتمل المهمة عند بلوغ النسبة المحددة.'],
                  ] as const
                ).map(([k, l, h]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={k === 'individual' && hasSubsteps}
                    onClick={() => setMode(k)}
                    aria-pressed={mode === k}
                    className={cn('rounded-xl border p-3 text-right transition disabled:opacity-40', mode === k ? 'border-teal bg-surface shadow-card' : 'border-line hover:bg-surface')}
                  >
                    <span className="block text-sm font-bold text-ink">{l}</span>
                    <span className="block text-xs text-muted">{h}</span>
                  </button>
                ))}
              </div>
              {hasSubsteps && <p className="mt-2 text-xs text-muted">المهمة مقسمة إلى مراحل فرعية فتبقى تعاونية.</p>}
              {mode === 'individual' && (
                <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  تكتمل المهمة عندما ينجزها
                  <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="h-9 rounded-full border border-line bg-surface px-3 text-sm">
                    <option value={100}>جميع المكلفين</option>
                    <option value={90}>90٪ من المكلفين</option>
                    <option value={75}>75٪ من المكلفين</option>
                    <option value={50}>نصف المكلفين</option>
                  </select>
                </label>
              )}
              <p className="mt-3 text-xs text-muted">في الحالتين تبقى المهمة سجلًا واحدًا بوزن واحد داخل النشاط، فلا يتضاعف الإنجاز بتعدد المكلفين.</p>
            </fieldset>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">{allDept ? `جميع موظفي الإدارة (${sel.length})` : `${sel.length} مختارون`}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? 'جارٍ الحفظ…' : 'حفظ الإسناد'}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
