'use client';
import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, ExternalLink, KeyRound, LockKeyhole, MonitorPlay, Pause, Pencil, Play, Plus, RotateCw, Trash2, Tv } from 'lucide-react';
import { Button, EmptyState, Input, Label, Panel, Pill, Select } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { QUARTER_LABEL } from '@/lib/labels';
import { cn, fmtDateTime, fmtDateY } from '@/lib/format';
import {
  createShareLinkAction,
  revokeShareLinkAction,
  rotateShareTokenAction,
  setShareCodeAction,
  toggleShareLinkAction,
  updateShareLinkAction,
  type ShareLinkInput,
} from '@/app/actions/share';

export interface LinkRow {
  id: string;
  token: string;
  name: string;
  follow_current: boolean;
  year: number | null;
  quarter: number | null;
  allow_period_switch: boolean;
  show_operational: boolean;
  show_executive: boolean;
  show_activities: boolean;
  kpi_ids: string[] | null;
  kpi_limit: number;
  refresh_seconds: number;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
  view_count: number;
  protected: boolean;
}

type Kpi = { id: string; name: string; year: number };

const REFRESH = [
  [30, '30 ثانية'],
  [60, 'دقيقة'],
  [120, 'دقيقتان'],
  [300, '5 دقائق'],
  [600, '10 دقائق'],
  [1800, '30 دقيقة'],
  [3600, 'ساعة'],
] as const;

function stateOf(l: LinkRow): { label: string; tone: 'done' | 'nodata' | 'late' | 'stalled' } {
  if (l.revoked_at) return { label: 'ملغى نهائيًا', tone: 'stalled' };
  if (l.expires_at && Date.parse(l.expires_at) < Date.now()) return { label: 'منتهي الصلاحية', tone: 'late' };
  if (!l.is_active) return { label: 'موقوف', tone: 'nodata' };
  return { label: 'فعّال', tone: 'done' };
}

export function ShareLinksClient({ links, years, kpis }: { links: LinkRow[]; years: number[]; kpis: Kpi[] }) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );
  const [edit, setEdit] = useState<LinkRow | 'new' | null>(null);
  const [codeFor, setCodeFor] = useState<LinkRow | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const url = (token: string, tv = false) => `${origin}/share/${token}${tv ? '?tv=1' : ''}`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('نُسخ الرابط');
    } catch {
      toast.error('تعذر النسخ؛ انسخه يدويًا');
    }
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; token?: string }>, after?: (r: { token?: string }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.(r);
        router.refresh();
      } else toast.error(r.error ?? 'تعذر التنفيذ');
    });

  const live = links.filter((l) => !l.revoked_at);
  const revoked = links.filter((l) => l.revoked_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {live.length ? `${live.length} رابط` : 'لا روابط بعد'}
          {revoked.length ? ` · ${revoked.length} ملغى` : ''}
        </p>
        <Button variant="accent" onClick={() => setEdit('new')}>
          <Plus size={17} /> رابط عرض جديد
        </Button>
      </div>

      {fresh && (
        <Panel className="border-teal p-5">
          <p className="font-semibold text-ink">الرابط جاهز</p>
          <p className="mt-1 text-sm text-muted">انسخه الآن وشاركه مع من تريد. يمكنك نسخه لاحقًا من بطاقة الرابط.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 text-xs">
              {url(fresh)}
            </code>
            <Button onClick={() => copy(url(fresh))}>
              <Copy size={16} /> نسخ
            </Button>
            <Button variant="secondary" onClick={() => window.open(url(fresh), '_blank', 'noopener')}>
              <ExternalLink size={16} /> فتح
            </Button>
          </div>
        </Panel>
      )}

      {links.length === 0 ? (
        <EmptyState
          title="لم تنشئ أي رابط عرض بعد"
          body="أنشئ رابطًا لعرض مؤشرات الأداء على شاشة الاستقبال أو في اجتماع مجلس الإدارة، دون منح صلاحية دخول للمنصة."
          action={
            <Button variant="accent" onClick={() => setEdit('new')}>
              <Plus size={17} /> رابط عرض جديد
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...live, ...revoked].map((l) => {
            const s = stateOf(l);
            const off = !!l.revoked_at;
            return (
              <Panel key={l.id} className={cn('flex flex-col p-5', off && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 font-semibold text-ink">
                      <MonitorPlay size={17} className="shrink-0 text-teal" />
                      <span className="truncate">{l.name}</span>
                    </h3>
                    <p className="mt-0.5 text-sm text-muted">
                      {l.follow_current ? 'الفترة الحالية دائمًا' : `${QUARTER_LABEL[l.quarter ?? 4]} ${l.year}م`}
                      {l.allow_period_switch ? ' · يسمح بتبديل الفترة' : ''}
                    </p>
                  </div>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  {l.show_operational && <Tag>المحور التشغيلي</Tag>}
                  {l.show_executive && <Tag>المحور التنفيذي{l.kpi_ids?.length ? ` (${l.kpi_ids.length} مؤشرات)` : ''}</Tag>}
                  {l.show_activities && <Tag>تفاصيل المشاريع والأنشطة</Tag>}
                  {l.protected ? (
                    <Tag tone="orange">
                      <LockKeyhole size={12} /> برمز وصول
                    </Tag>
                  ) : (
                    <Tag>عام لمن يملك الرابط</Tag>
                  )}
                  <Tag>تحديث كل {REFRESH.find(([v]) => v === l.refresh_seconds)?.[1] ?? `${l.refresh_seconds} ث`}</Tag>
                </ul>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
                  <div>
                    <dt>ينتهي</dt>
                    <dd className="text-text">{l.expires_at ? fmtDateY(l.expires_at) : 'بلا انتهاء'}</dd>
                  </div>
                  <div>
                    <dt>المشاهدات</dt>
                    <dd className="num text-text" style={{ textAlign: 'right' }}>{l.view_count}</dd>
                  </div>
                  <div>
                    <dt>آخر فتح</dt>
                    <dd className="text-text">{l.last_viewed_at ? fmtDateTime(l.last_viewed_at) : '—'}</dd>
                  </div>
                </dl>
                {!off && (
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    <Button className="h-9 px-3" onClick={() => copy(url(l.token))}>
                      <Copy size={15} /> نسخ الرابط
                    </Button>
                    <Button variant="secondary" className="h-9 px-3" onClick={() => window.open(url(l.token), '_blank', 'noopener')}>
                      <ExternalLink size={15} /> فتح
                    </Button>
                    <Button variant="ghost" className="h-9 px-2.5" title="رابط وضع التلفاز" onClick={() => copy(url(l.token, true))}>
                      <Tv size={15} /> رابط التلفاز
                    </Button>
                    <span className="ms-auto flex gap-0.5">
                      <IconAction label="تعديل" onClick={() => setEdit(l)}>
                        <Pencil size={15} />
                      </IconAction>
                      <IconAction label="رمز الوصول" onClick={() => setCodeFor(l)}>
                        <KeyRound size={15} />
                      </IconAction>
                      <IconAction label={l.is_active ? 'إيقاف مؤقت' : 'تفعيل'} disabled={pending} onClick={() => run(() => toggleShareLinkAction(l.id, !l.is_active))}>
                        {l.is_active ? <Pause size={15} /> : <Play size={15} />}
                      </IconAction>
                      <IconAction
                        label="إصدار رابط جديد"
                        disabled={pending}
                        onClick={() => confirm('سيتوقف الرابط الحالي فورًا ويصدر رابط جديد بنفس الإعدادات. متابعة؟') && run(() => rotateShareTokenAction(l.id), (r) => r.token && setFresh(r.token))}
                      >
                        <RotateCw size={15} />
                      </IconAction>
                      <IconAction
                        label="إلغاء نهائي"
                        danger
                        disabled={pending}
                        onClick={() => confirm(`إلغاء «${l.name}» نهائيًا؟ لن يعمل الرابط بعد الآن ولا يمكن التراجع.`) && run(() => revokeShareLinkAction(l.id))}
                      >
                        <Trash2 size={15} />
                      </IconAction>
                    </span>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {edit && (
        <LinkForm
          link={edit === 'new' ? null : edit}
          years={years}
          kpis={kpis}
          onClose={() => setEdit(null)}
          onCreated={(t) => setFresh(t)}
        />
      )}
      {codeFor && <CodeForm link={codeFor} onClose={() => setCodeFor(null)} />}
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'orange' }) {
  return <li className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1', tone === 'orange' ? 'bg-orange-soft text-late' : 'bg-sunken text-text')}>{children}</li>;
}

function IconAction({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} disabled={disabled} className={cn('grid h-9 w-9 place-items-center rounded-lg transition disabled:opacity-40', danger ? 'text-stalled hover:bg-stalled-soft' : 'text-muted hover:bg-sunken hover:text-text')}>
      {children}
    </button>
  );
}

function LinkForm({ link, years, kpis, onClose, onCreated }: { link: LinkRow | null; years: number[]; kpis: Kpi[]; onClose: () => void; onCreated: (token: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cy = new Date().getFullYear();
  const [f, setF] = useState<ShareLinkInput & { code: string; expires: boolean }>({
    name: link?.name ?? '',
    follow_current: link?.follow_current ?? true,
    year: link?.year ?? (years.includes(cy) ? cy : years[0] ?? cy),
    quarter: link?.quarter ?? Math.ceil((new Date().getMonth() + 1) / 3),
    allow_period_switch: link?.allow_period_switch ?? false,
    show_operational: link?.show_operational ?? true,
    show_executive: link?.show_executive ?? true,
    show_activities: link?.show_activities ?? false,
    kpi_ids: link?.kpi_ids ?? null,
    kpi_limit: link?.kpi_limit ?? 9,
    refresh_seconds: link?.refresh_seconds ?? 300,
    expires_at: link?.expires_at ? link.expires_at.slice(0, 10) : null,
    expires: !!link?.expires_at,
    code: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const kpiYear = f.follow_current ? cy : f.year;
  const yearKpis = kpis.filter((k) => k.year === kpiYear);
  const pickAll = !f.kpi_ids;

  const submit = () =>
    start(async () => {
      const input: ShareLinkInput = { ...f, expires_at: f.expires ? f.expires_at : null };
      const r = link ? await updateShareLinkAction(link.id, input) : await createShareLinkAction({ ...input, code: f.code || null });
      if (r.ok) {
        toast.success(r.message ?? 'تم');
        const t = (r as { token?: string }).token;
        if (!link && t) onCreated(t);
        onClose();
        router.refresh();
      } else toast.error(r.error ?? 'تعذر الحفظ');
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={link ? 'تعديل رابط العرض' : 'رابط عرض جديد'} description="يُعرض في الرابط ما تختاره هنا فقط." wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <Label htmlFor="sl-name">اسم الرابط</Label>
          <Input id="sl-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: شاشة الاستقبال، اجتماع مجلس الإدارة" required autoFocus />
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-text">الفترة</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice checked={f.follow_current} onChange={() => set('follow_current', true)} title="الفترة الحالية دائمًا" body="ينتقل تلقائيًا للربع الجاري" />
            <Choice checked={!f.follow_current} onChange={() => set('follow_current', false)} title="فترة محددة" body="سنة وربع ثابتان" />
          </div>
          {!f.follow_current && (
            <div className="grid grid-cols-2 gap-2">
              <Select aria-label="السنة" value={f.year ?? ''} onChange={(e) => set('year', Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}م
                  </option>
                ))}
              </Select>
              <Select aria-label="الربع" value={f.quarter ?? 1} onChange={(e) => set('quarter', Number(e.target.value))}>
                {[1, 2, 3, 4].map((q) => (
                  <option key={q} value={q}>
                    {QUARTER_LABEL[q]}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Check checked={f.allow_period_switch} onChange={(v) => set('allow_period_switch', v)} label="السماح للمشاهد بالتبديل بين السنوات والأرباع" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-text">البيانات المعروضة</legend>
          <Check checked={f.show_operational} onChange={(v) => set('show_operational', v)} label="المحور التشغيلي: إنجاز الجمعية والإدارات، أعداد المشاريع والأنشطة والمهام، المخطط مقابل المتحقق" />
          {f.show_operational && (
            <div className="ms-7">
              <Check checked={f.show_activities} onChange={(v) => set('show_activities', v)} label="السماح بالتعمق: أسماء المشاريع والأنشطة ونسبها داخل كل إدارة" />
            </div>
          )}
          <Check checked={f.show_executive} onChange={(v) => set('show_executive', v)} label="المحور التنفيذي: الأهداف والمؤشرات (المستهدف والمتحقق ونسبة التحقق)" />
          {f.show_executive && (
            <div className="ms-7 space-y-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={pickAll} onChange={() => set('kpi_ids', null)} className="accent-[var(--teal)]" /> أول المؤشرات بحسب الترتيب
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!pickAll} onChange={() => set('kpi_ids', [])} className="accent-[var(--teal)]" /> مؤشرات مختارة
                </label>
                <span className="ms-auto flex items-center gap-2">
                  عدد البطاقات
                  <Input type="number" min={1} max={12} value={f.kpi_limit} onChange={(e) => set('kpi_limit', Number(e.target.value))} className="h-9 w-20" />
                </span>
              </div>
              {!pickAll && (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {yearKpis.length === 0 && <li className="text-muted">لا مؤشرات في الخطة التنفيذية لسنة {kpiYear}م.</li>}
                  {yearKpis.map((k) => (
                    <li key={k.id}>
                      <label className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-sunken">
                        <input
                          type="checkbox"
                          className="accent-[var(--teal)]"
                          checked={!!f.kpi_ids?.includes(k.id)}
                          onChange={(e) => set('kpi_ids', e.target.checked ? [...(f.kpi_ids ?? []), k.id] : (f.kpi_ids ?? []).filter((x) => x !== k.id))}
                        />
                        {k.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-xs text-muted">لا تُعرض أبدًا: التوجيهات، الاعتمادات المعلقة، الملاحظات، بيانات الموظفين، الملفات والشواهد.</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sl-refresh">التحديث التلقائي</Label>
            <Select id="sl-refresh" value={f.refresh_seconds} onChange={(e) => set('refresh_seconds', Number(e.target.value))}>
              {REFRESH.map(([v, l]) => (
                <option key={v} value={v}>
                  كل {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sl-exp">انتهاء الصلاحية</Label>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={f.expires} onChange={(e) => set('expires', e.target.checked)} aria-label="تحديد تاريخ انتهاء" className="accent-[var(--teal)]" />
              <Input id="sl-exp" type="date" disabled={!f.expires} value={f.expires_at ?? ''} onChange={(e) => set('expires_at', e.target.value)} min={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
        </div>

        {!link && (
          <div>
            <Label htmlFor="sl-code" hint="اختياري — 6 أحرف على الأقل. اتركه فارغًا ليكون الرابط عامًا لمن يملكه">
              رمز الوصول
            </Label>
            <Input id="sl-code" type="password" autoComplete="new-password" value={f.code} onChange={(e) => set('code', e.target.value)} dir="ltr" />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'جارٍ الحفظ…' : link ? 'حفظ' : 'إنشاء الرابط'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CodeForm({ link, onClose }: { link: LinkRow; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (value: string | null) =>
    start(async () => {
      const r = await setShareCodeAction(link.id, value);
      if (r.ok) {
        toast.success(r.message ?? 'تم');
        onClose();
        router.refresh();
      } else toast.error(r.error ?? 'تعذر الحفظ');
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="رمز الوصول" description={link.protected ? 'الرابط محمي حاليًا. يمكنك تغيير الرمز أو إزالته.' : 'الرابط عام حاليًا لمن يملكه.'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(code);
        }}
      >
        <div>
          <Label htmlFor="sl-newcode" hint="6 أحرف على الأقل. يُحفظ مشفرًا ولا يمكن استرجاعه">
            {link.protected ? 'رمز جديد' : 'رمز الوصول'}
          </Label>
          <Input id="sl-newcode" type="password" autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" autoFocus />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          {link.protected ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => go(null)}>
              إزالة الرمز
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending || code.trim().length < 6}>
            حفظ الرمز
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Choice({ checked, onChange, title, body }: { checked: boolean; onChange: () => void; title: string; body: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition', checked ? 'border-teal bg-teal-soft/50' : 'border-line hover:bg-sunken')}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 accent-[var(--teal)]" />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{body}</span>
      </span>
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[var(--teal)]" />
      <span>{label}</span>
    </label>
  );
}
