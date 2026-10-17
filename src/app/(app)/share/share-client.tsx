'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, ExternalLink, KeyRound, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { Button, Input, Label, Select } from '@/components/ui';
import { createShareLinkAction, revokeShareLinkAction, toggleShareLinkAction, updateShareLinkAction, type ShareLinkInput } from '@/app/actions/share';
import { cn } from '@/lib/format';

export interface LinkRow {
  id: string;
  token: string;
  name: string;
  year: number;
  quarter: number | null;
  allow_period_nav: boolean;
  sections: ShareLinkInput['sections'];
  kpi_ids: string[] | null;
  kpi_limit: number;
  access_mode: 'public' | 'code';
  expires_at: string | null;
  is_active: boolean;
  refresh_seconds: number;
}

const SECTION_LABELS: [keyof ShareLinkInput['sections'], string, string][] = [
  ['ops', 'الأداء التشغيلي', 'إجمالي الإنجاز، والمشاريع والأنشطة، والمهام'],
  ['departments', 'نسب إنجاز الإدارات', 'مع إمكانية فتح تفاصيلها على الكمبيوتر'],
  ['curve', 'منحنى المخطط والمتحقق', 'وإنجاز أرباع السنة'],
  ['exec', 'الأداء التنفيذي السنوي', 'الأهداف ومؤشرات الأداء (من الخطة التنفيذية المعتمدة)'],
  ['activity_titles', 'أسماء المشاريع والأنشطة', 'في نافذة التفاصيل (دون أسماء المهام أو الموظفين)'],
];

export function CopyLink({ token }: { token: string }) {
  return (
    <Button
      variant="secondary"
      className="h-9"
      onClick={async () => {
        const url = `${window.location.origin}/display/${token}`;
        try {
          await navigator.clipboard.writeText(url);
          toast.success('نُسخ الرابط');
        } catch {
          prompt('انسخ الرابط', url);
        }
      }}
    >
      <Copy size={15} /> نسخ الرابط
    </Button>
  );
}

export function LinkActions({ link, kpis, years }: { link: LinkRow; kpis: { id: string; name: string }[]; years: number[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-2">
      <CopyLink token={link.token} />
      <a href={`/display/${link.token}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold text-teal hover:bg-teal-soft">
        <ExternalLink size={15} /> فتح
      </a>
      <LinkEditor link={link} kpis={kpis} years={years} trigger="icon" />
      <Button variant="ghost" className="h-9" disabled={pending} onClick={() => run(() => toggleShareLinkAction(link.id, !link.is_active))}>
        <Power size={15} /> {link.is_active ? 'تعطيل' : 'تفعيل'}
      </Button>
      <Button variant="ghost" className="h-9 text-stalled" disabled={pending} onClick={() => confirm(`إلغاء الرابط «${link.name}» نهائيًا؟ لن يعمل لمن يملكه.`) && run(() => revokeShareLinkAction(link.id))}>
        <Trash2 size={15} /> إلغاء
      </Button>
    </div>
  );
}

export function LinkEditor({ link, kpis, years, trigger = 'button', defaultYear }: { link?: LinkRow; kpis: { id: string; name: string }[]; years: number[]; trigger?: 'button' | 'icon'; defaultYear?: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [f, setF] = useState<ShareLinkInput>({
    name: link?.name ?? 'لوحة الأداء — شاشة المقر',
    year: link?.year ?? defaultYear ?? years[0] ?? new Date().getFullYear(),
    quarter: link?.quarter ?? null,
    allowNav: link?.allow_period_nav ?? false,
    sections: link?.sections ?? { ops: true, departments: true, curve: true, exec: true, activity_titles: false },
    kpiIds: link?.kpi_ids ?? [],
    kpiLimit: link?.kpi_limit ?? 8,
    expiresAt: link?.expires_at ? link.expires_at.slice(0, 10) : null,
    refreshSeconds: link?.refresh_seconds ?? 300,
    accessCode: link ? '' : null,
  });
  const [protect, setProtect] = useState(link ? link.access_mode === 'code' : false);
  const [created, setCreated] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      const input: ShareLinkInput = { ...f, accessCode: protect ? (f.accessCode ?? '') : null };
      if (!link && protect && !input.accessCode) return void toast.error('اكتب رمز الوصول');
      if (link && protect && link.access_mode !== 'code' && !input.accessCode) return void toast.error('اكتب رمز الوصول');
      if (link) {
        const r = await updateShareLinkAction(link.id, input);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message);
        setOpen(false);
      } else {
        const r = await createShareLinkAction(input);
        if (!r.ok) return void toast.error(r.error);
        setCreated(r.token);
        toast.success('أُنشئ الرابط');
      }
      router.refresh();
    });

  const toggleKpi = (id: string) => setF((x) => ({ ...x, kpiIds: x.kpiIds.includes(id) ? x.kpiIds.filter((k) => k !== id) : [...x.kpiIds, id] }));

  return (
    <>
      {trigger === 'button' ? (
        <Button variant="accent" onClick={() => (setCreated(null), setOpen(true))}>
          <Plus size={16} /> رابط عرض جديد
        </Button>
      ) : (
        <Button variant="ghost" className="h-9" onClick={() => setOpen(true)}>
          <Pencil size={15} /> تعديل
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={link ? 'تعديل رابط العرض' : 'رابط عرض جديد'} description="لوحة مستقلة تعرض البيانات المعتمدة فقط، دون الدخول إلى المنصة" wide>
        {created ? (
          <div className="space-y-4 text-center">
            <p className="font-display text-xl font-bold text-ink">الرابط جاهز</p>
            <p className="text-sm text-muted">انسخه وشاركه أو اعرضه على شاشة المقر. يمكنك تعطيله أو إلغاؤه في أي وقت.</p>
            <code dir="ltr" className="block rounded-2xl bg-sunken px-4 py-3 text-xs break-all">{`${typeof window !== 'undefined' ? window.location.origin : ''}/display/${created}`}</code>
            <div className="flex justify-center gap-2">
              <CopyLink token={created} />
              <Button onClick={() => setOpen(false)}>تم</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <Label htmlFor="ln">اسم وصفي</Label>
              <Input id="ln" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: شاشة المقر، مجلس الإدارة، الجهة المانحة" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="ly">السنة</Label>
                <Select id="ly" value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}م
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lq">الربع</Label>
                <Select id="lq" value={f.quarter ?? ''} onChange={(e) => setF({ ...f, quarter: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">الربع الجاري تلقائيًا</option>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      الربع {['', 'الأول', 'الثاني', 'الثالث', 'الرابع'][q]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lr">التحديث التلقائي</Label>
                <Select id="lr" value={f.refreshSeconds} onChange={(e) => setF({ ...f, refreshSeconds: Number(e.target.value) })}>
                  <option value={60}>كل دقيقة</option>
                  <option value={120}>كل دقيقتين</option>
                  <option value={300}>كل 5 دقائق</option>
                  <option value={600}>كل 10 دقائق</option>
                  <option value={1800}>كل 30 دقيقة</option>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={f.allowNav} onChange={(e) => setF({ ...f, allowNav: e.target.checked })} />
              السماح للمشاهد بالتنقل بين السنوات والأرباع
            </label>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold">البيانات المسموح بعرضها</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECTION_LABELS.map(([k, l, h]) => (
                  <label key={k} className={cn('flex cursor-pointer gap-3 rounded-2xl border p-3', f.sections[k] ? 'border-teal bg-teal-soft/50' : 'border-line')}>
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--teal)]" checked={f.sections[k]} onChange={(e) => setF({ ...f, sections: { ...f.sections, [k]: e.target.checked } })} />
                    <span>
                      <span className="block text-sm font-semibold">{l}</span>
                      <span className="block text-xs text-muted">{h}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">لا تُعرض أبدًا: التوجيهات، الاعتمادات المعلقة، الملاحظات، الشواهد، أسماء الموظفين، أو الخطط غير المعتمدة.</p>
            </fieldset>

            {f.sections.exec && (
              <fieldset>
                <legend className="mb-1 text-sm font-semibold">مؤشرات الأداء المعروضة</legend>
                <p className="mb-2 text-xs text-muted">لمنع ازدحام الشاشة اختر المؤشرات ذات الأولوية بالترتيب، أو اتركها فارغة لعرض أول المؤشرات.</p>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  الحد الأقصى في الشاشة
                  <Input type="number" min={1} max={40} value={f.kpiLimit} onChange={(e) => setF({ ...f, kpiLimit: Number(e.target.value) })} className="num h-9 w-20 text-center" />
                </div>
                {kpis.length === 0 ? (
                  <p className="text-xs text-muted">لا توجد مؤشرات في خطة تنفيذية لهذه السنة بعد.</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
                    {kpis.map((k) => {
                      const i = f.kpiIds.indexOf(k.id);
                      return (
                        <li key={k.id}>
                          <label className={cn('flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm', i >= 0 ? 'bg-teal-soft' : 'hover:bg-sunken')}>
                            <input type="checkbox" className="h-4 w-4 accent-[var(--teal)]" checked={i >= 0} onChange={() => toggleKpi(k.id)} />
                            <span className="flex-1">{k.name}</span>
                            {i >= 0 && <span className="num rounded-full bg-orange px-2 text-xs font-bold text-[#2b1700]">{i + 1}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="le" hint="اختياري">تاريخ انتهاء الصلاحية</Label>
                <Input id="le" type="date" dir="ltr" value={f.expiresAt ?? ''} onChange={(e) => setF({ ...f, expiresAt: e.target.value || null })} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold">الوصول</span>
                <div className="flex rounded-full border border-line bg-sunken p-1 text-sm">
                  <button type="button" onClick={() => setProtect(false)} className={cn('flex-1 rounded-full py-1.5', !protect && 'bg-surface font-semibold shadow-card')}>
                    عام لمن يملك الرابط
                  </button>
                  <button type="button" onClick={() => setProtect(true)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-full py-1.5', protect && 'bg-surface font-semibold shadow-card')}>
                    <KeyRound size={14} /> برمز وصول
                  </button>
                </div>
              </div>
            </div>
            {protect && (
              <div>
                <Label htmlFor="lc" hint={link?.access_mode === 'code' ? 'اتركه فارغًا للإبقاء على الرمز الحالي' : '4 خانات على الأقل'}>
                  رمز الوصول
                </Label>
                <Input id="lc" value={f.accessCode ?? ''} onChange={(e) => setF({ ...f, accessCode: e.target.value })} autoComplete="off" dir="ltr" className="text-center tracking-widest" />
                <p className="mt-1 text-xs text-muted">يُحفظ الرمز مُجزّأً ولا يمكن عرضه لاحقًا. بعد 5 محاولات خاطئة يُوقف الرابط ربع ساعة.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? 'جارٍ الحفظ…' : link ? 'حفظ' : 'إنشاء الرابط'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
