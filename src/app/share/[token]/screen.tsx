'use client';
// =====================================================================
// لوحة العرض الخارجية: شاشة واحدة 16:9 بلا تمرير طويل، مناسبة للتلفاز
// والعرض الكامل، وتتحول إلى عرض عمودي مريح على الجوال.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CircleAlert, Expand, Minimize, Moon, Pause, Play, RefreshCw, Sun, Tv, X } from 'lucide-react';
import { Logo } from '@/components/brand';
import { CurveChart } from '@/components/dashboard/curve';
import type { ShareDept, ShareKpi, ShareView } from '@/lib/share/view';
import { ACTIVITY_STATE, DATA_STATE, KPI_STATUS, QUARTER_LABEL } from '@/lib/labels';
import { cn, fmtNum, fmtPct } from '@/lib/format';

type Axis = 'ops' | 'exec';
const tf = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
const dtf = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' });

const kpiColor: Record<string, string> = {
  achieved: 'var(--done)',
  on_track: 'var(--teal)',
  at_risk: 'var(--orange)',
  off_track: 'var(--stalled)',
  no_data: 'var(--nodata)',
  no_target: 'var(--nodata)',
};

function pctColor(p: number | null, planned: number | null) {
  if (p === null) return 'var(--nodata)';
  if (p >= 100) return 'var(--done)';
  if (planned !== null && p + 10 < planned) return 'var(--orange)';
  return 'var(--teal)';
}

// تفضيل الوضع (داكن/فاتح) لهذا الجهاز فقط
const THEME_KEY = 'share-theme';
const themeStore = {
  subscribe(cb: () => void) {
    window.addEventListener('storage', cb);
    window.addEventListener('share-theme', cb);
    return () => {
      window.removeEventListener('storage', cb);
      window.removeEventListener('share-theme', cb);
    };
  },
  get(): boolean {
    try {
      return localStorage.getItem(THEME_KEY) !== 'light';
    } catch {
      return true;
    }
  },
  set(dark: boolean) {
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {}
    window.dispatchEvent(new Event('share-theme'));
  },
};

export function ShareScreen({ token, initial, tvMode = false }: { token: string; initial: ShareView; tvMode?: boolean }) {
  const [view, setView] = useState(initial);
  const [lastOk, setLastOk] = useState(() => new Date());
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState<null | 'invalid' | 'expired'>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [period, setPeriod] = useState<{ y: number | null; q: number | null }>({ y: null, q: null });
  const both = !!view.ops && !!view.exec;
  const [axis, setAxis] = useState<Axis>(view.ops ? 'ops' : 'exec');
  const [rotate, setRotate] = useState(tvMode);
  const [tv, setTv] = useState(tvMode);
  const [full, setFull] = useState(false);
  const dark = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => true);
  const [drill, setDrill] = useState<ShareDept | null>(null);
  const [idle, setIdle] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(
    async (opts?: { y?: number | null; q?: number | null }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      const y = opts?.y !== undefined ? opts.y : period.y;
      const q = opts?.q !== undefined ? opts.q : period.q;
      const qs = new URLSearchParams();
      if (y) qs.set('y', String(y));
      if (q) qs.set('q', String(q));
      try {
        const res = await fetch(`/api/share/${token}?${qs}`, { cache: 'no-store' });
        if (res.status === 410) {
          const b = await res.json().catch(() => ({}));
          setGone(b.reason === 'expired' ? 'expired' : 'invalid');
          return;
        }
        if (res.status === 401) {
          // تغيّر رمز الوصول أو قُفل: إعادة التحميل تُظهر شاشة الرمز
          window.location.reload();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ShareView;
        setView(data);
        setLastOk(new Date());
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [token, period],
  );

  // التحديث الدوري بحسب إعداد الرابط، وعند العودة إلى التبويب
  useEffect(() => {
    const ms = Math.max(30, view.settings.refreshSeconds) * 1000;
    const id = window.setInterval(() => refresh(), failed ? Math.min(ms, 30_000) : ms);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh, view.settings.refreshSeconds, failed]);

  // الساعة
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // التدوير بين المحورين في وضع التلفاز
  useEffect(() => {
    if (!rotate || !both || drill) return;
    const id = window.setInterval(() => setAxis((a) => (a === 'ops' ? 'exec' : 'ops')), 25_000);
    return () => window.clearInterval(id);
  }, [rotate, both, drill]);

  // إخفاء أدوات التحكم والمؤشر عند الخمول في وضع التلفاز/ملء الشاشة
  useEffect(() => {
    if (!tv && !full) return;
    let t = window.setTimeout(() => setIdle(true), 4000);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 4000);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [tv, full]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  };
  const toggleTheme = () => themeStore.set(!dark);
  const changePeriod = (y: number, q: number) => {
    setPeriod({ y, q });
    const u = new URL(window.location.href);
    u.searchParams.set('y', String(y));
    u.searchParams.set('q', String(q));
    window.history.replaceState(null, '', u);
    refresh({ y, q });
  };

  if (gone) {
    return (
      <main data-theme="dark" className="grid min-h-dvh place-items-center bg-paper p-6 text-text">
        <div className="max-w-md text-center">
          <Logo light className="mx-auto mb-8 w-44" />
          <h1 className="text-2xl font-bold text-ink">{gone === 'expired' ? 'انتهت صلاحية هذا الرابط' : 'لم يعد هذا الرابط متاحًا'}</h1>
          <p className="mt-2 text-muted">أوقف مالك الرابط العرض أو انتهت مدته.</p>
        </div>
      </main>
    );
  }

  const hideUi = (tv || full) && idle;

  return (
    <main
      data-theme={dark ? 'dark' : 'light'}
      className={cn('relative flex min-h-dvh flex-col bg-paper text-text lg:h-dvh lg:overflow-hidden', hideUi && 'cursor-none')}
    >
      {/* الشريط العلوي */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 brand-hero border-b border-white/10 px-4 py-3 text-white sm:px-6 lg:px-[2.2vw] lg:py-[1.4vh]">
        <Logo light className="h-11 w-auto lg:h-[6.4vh] lg:min-h-10" />
        <div className="min-w-0 border-s border-white/15 ps-5">
          <h1 className="truncate text-base font-bold sm:text-lg lg:text-[clamp(1rem,1.5vw,1.9rem)]">{view.name}</h1>
          <p className="text-xs text-white/65 lg:text-[clamp(.75rem,.85vw,1.05rem)]">
            {QUARTER_LABEL[view.quarter]} {view.year}م — {dtf.format(now)}
          </p>
        </div>

        {both && (
          <nav className="flex rounded-full bg-white/10 p-1 text-sm lg:text-[clamp(.8rem,.9vw,1.1rem)]" aria-label="المحور">
            {(
              [
                ['ops', 'الأداء التشغيلي'],
                ['exec', 'الأداء التنفيذي'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setAxis(k);
                  setRotate(false);
                }}
                aria-pressed={axis === k}
                className={cn('rounded-full px-4 py-1.5 transition', axis === k ? 'bg-orange font-semibold text-[#04141b]' : 'text-white/75 hover:text-white')}
              >
                {l}
              </button>
            ))}
          </nav>
        )}

        <div className="ms-auto flex items-center gap-3">
          {view.settings.allowPeriodSwitch && (
            <div className={cn('flex items-center gap-1 transition-opacity', hideUi && 'opacity-0')}>
              <select
                aria-label="السنة"
                value={view.year}
                onChange={(e) => changePeriod(Number(e.target.value), view.quarter)}
                className="rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-sm text-white [&>option]:text-black"
              >
                {view.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select
                aria-label="الربع"
                value={view.quarter}
                onChange={(e) => changePeriod(view.year, Number(e.target.value))}
                className="rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-sm text-white [&>option]:text-black"
              >
                {[1, 2, 3, 4].map((q) => (
                  <option key={q} value={q}>
                    {QUARTER_LABEL[q]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="num hidden text-[clamp(1.1rem,1.6vw,2rem)] font-semibold tabular-nums sm:block">{tf.format(now)}</p>
          <div className={cn('flex items-center gap-1 transition-opacity', hideUi && 'pointer-events-none opacity-0')}>
            <IconBtn label="تحديث الآن" onClick={() => refresh()}>
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </IconBtn>
            {both && (
              <IconBtn label={rotate ? 'إيقاف التدوير' : 'تدوير المحورين'} onClick={() => setRotate((r) => !r)}>
                {rotate ? <Pause size={17} /> : <Play size={17} />}
              </IconBtn>
            )}
            <IconBtn label={dark ? 'الوضع الفاتح' : 'الوضع الداكن'} onClick={toggleTheme}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </IconBtn>
            <IconBtn
              label={tv ? 'إنهاء وضع التلفاز' : 'وضع التلفاز'}
              onClick={() => {
                setTv((t) => !t);
                if (both) setRotate(!tv);
              }}
              active={tv}
            >
              <Tv size={17} />
            </IconBtn>
            <IconBtn label={full ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'} onClick={toggleFull}>
              {full ? <Minimize size={17} /> : <Expand size={17} />}
            </IconBtn>
          </div>
        </div>
      </header>

      {failed && (
        <div role="status" className="flex items-center gap-2 bg-orange-soft px-6 py-2 text-sm text-late">
          <CircleAlert size={16} /> تعذر تحديث البيانات. المعروض هو آخر تحديث ناجح ({tf.format(lastOk)})، وستُعاد المحاولة تلقائيًا.
        </div>
      )}

      {/* المحتوى */}
      <div className="min-h-0 flex-1 p-4 sm:p-6 lg:px-[2.2vw] lg:py-[2.2vh]">
        {axis === 'ops' && view.ops && <Operational ops={view.ops} drillable={view.settings.showActivities} onDrill={setDrill} />}
        {axis === 'exec' && view.exec && <Executive exec={view.exec} />}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted sm:px-6 lg:px-[2.2vw] lg:text-[clamp(.7rem,.75vw,.95rem)]">
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', failed ? 'bg-orange' : 'bg-done')} aria-hidden />
          آخر تحديث ناجح: <span className="num">{tf.format(lastOk)}</span> — يتحدث تلقائيًا كل {fmtRefresh(view.settings.refreshSeconds)}
        </span>
        <span>جمعية رواسم — منصة الأداء المؤسسي · أرقام من الخطط المعتمدة فقط</span>
      </footer>

      {drill && <DrillPanel dept={drill} onClose={() => setDrill(null)} />}
    </main>
  );
}

function fmtRefresh(s: number) {
  if (s < 60) return `${s} ثانية`;
  const m = Math.round(s / 60);
  return m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? `${m} دقائق` : `${m} دقيقة`;
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={cn('grid h-9 w-9 place-items-center rounded-full transition hover:bg-white/15', active ? 'bg-white/20' : 'text-white/80')}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// المحور التشغيلي
// ---------------------------------------------------------------------
function Operational({ ops, drillable, onDrill }: { ops: NonNullable<ShareView['ops']>; drillable: boolean; onDrill: (d: ShareDept) => void }) {
  if (!ops.hasPlans) {
    return <Empty title="لا توجد خطط تشغيلية معتمدة لهذه الفترة" body="تظهر الأرقام هنا فور اعتماد خطط الإدارات." />;
  }
  const main = ops.computable ? ops.progress : ops.partialProgress;
  const c = ops.counts;
  const gap = main !== null && ops.planned !== null ? Math.round((main - ops.planned) * 10) / 10 : null;
  return (
    <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] lg:gap-[1.6vw]">
      {/* العمود الأول: الإنجاز العام والعدادات */}
      <div className="flex min-h-0 flex-col gap-4 lg:gap-[2vh]">
        <Card className="relative flex flex-col overflow-hidden lg:flex-[1.15]">
          <p className="text-sm text-muted lg:text-[clamp(.85rem,1vw,1.3rem)]">إنجاز الخطة التشغيلية</p>
          <div className="mt-1 flex items-end gap-4">
            <p className="num font-bold leading-none tracking-tight text-ink text-[clamp(3.5rem,7.5vw,9.5rem)]">
              {fmtNum(main)}
              <span className="text-[0.45em] text-muted">٪</span>
            </p>
          </div>
          {!ops.computable && <p className="mt-2 text-sm text-late">مؤشر جزئي: بعض الإدارات بلا خطة معتمدة</p>}
          <div className="mt-auto pt-[2vh]">
            <Bar value={main} planned={ops.planned} color={pctColor(main, ops.planned)} thick />
          </div>
          <dl className="mt-[1.8vh] grid grid-cols-2 gap-3 text-[clamp(.8rem,.95vw,1.25rem)]">
            <div>
              <dt className="text-muted">المخطط حتى اليوم</dt>
              <dd className="num text-[1.5em] font-semibold text-ink">{fmtPct(ops.planned)}</dd>
            </div>
            <div>
              <dt className="text-muted">الفارق عن المخطط</dt>
              <dd className="num text-[1.5em] font-semibold" style={{ color: gap === null ? 'var(--muted)' : gap >= -5 ? 'var(--done)' : 'var(--late)' }}>
                {gap === null ? '—' : `${gap > 0 ? '+' : ''}${fmtNum(gap)}٪`}
              </dd>
            </div>
          </dl>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex-1 lg:gap-[1.6vh]">
          <CountCard
            title="المشاريع والأنشطة"
            total={c.works.total}
            sub={`${fmtNum(c.works.projects)} مشروع · ${fmtNum(c.works.activities)} نشاط`}
            rows={[
              ['مكتملة', c.works.completed, 'var(--done)'],
              ['جارية', c.works.inProgress, 'var(--teal)'],
              ['متأخرة', c.works.late, 'var(--orange)'],
            ]}
          />
          <CountCard
            title="المهام التنفيذية"
            total={c.tasks.total}
            sub="داخل المشاريع والأنشطة"
            rows={[
              ['مكتملة', c.tasks.completed, 'var(--done)'],
              ['جارية', c.tasks.inProgress, 'var(--teal)'],
              ['متأخرة', c.tasks.late, 'var(--orange)'],
            ]}
          />
        </div>
      </div>

      {/* العمود الثاني: الإدارات والمنحنى */}
      <div className="flex min-h-0 flex-col gap-4 lg:gap-[2vh]">
        <Card className="lg:flex lg:min-h-0 lg:flex-[1.35] lg:flex-col">
          <div className="mb-[1.2vh] flex items-center justify-between">
            <h2 className="font-semibold text-ink lg:text-[clamp(1rem,1.15vw,1.5rem)]">إنجاز الإدارات</h2>
            <p className="flex items-center gap-2 text-xs text-muted lg:text-[clamp(.7rem,.8vw,1rem)]">
              <span className="inline-block h-3 w-[3px] rounded bg-ink" /> المخطط حتى اليوم
              {drillable && <span className="hidden lg:inline">· اضغط على الإدارة للتفاصيل</span>}
            </p>
          </div>
          <ol className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:gap-[1vh]">
            {ops.depts.map((d) => (
              <DeptRow key={d.id} d={d} onClick={drillable ? () => onDrill(d) : undefined} />
            ))}
          </ol>
        </Card>
        <Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <h2 className="mb-1 font-semibold text-ink lg:text-[clamp(1rem,1.1vw,1.4rem)]">المخطط مقابل المتحقق</h2>
          <div className="h-56 lg:h-auto lg:min-h-0 lg:flex-1">
            <CurveChart data={ops.curve} height="100%" big />
          </div>
        </Card>
      </div>
    </div>
  );
}

function DeptRow({ d, onClick }: { d: ShareDept; onClick?: () => void }) {
  const has = d.progress !== null;
  const color = pctColor(d.progress, d.planned);
  const Tag = onClick ? 'button' : 'div';
  return (
    <li className="lg:min-h-0 lg:flex-1">
      <Tag
        {...(onClick ? { onClick, type: 'button' as const } : {})}
        className={cn('relative flex h-full w-full items-center gap-4 overflow-hidden rounded-xl border border-line bg-sunken px-4 py-2.5 text-start lg:py-[0.6vh]', onClick && 'transition hover:border-teal')}
      >
        {has && <div className="settle absolute inset-y-0 right-0" style={{ width: `${d.progress}%`, background: `color-mix(in oklab, ${color} 22%, transparent)`, borderBottom: `4px solid ${color}` }} />}
        {has && d.planned !== null && d.planned > 0 && <div className="absolute bottom-0 h-[45%] w-[3px] rounded-t-full bg-ink" style={{ right: `calc(${Math.min(100, d.planned)}% - 1.5px)` }} />}
        <div className="relative min-w-0 flex-1">
          <p className="truncate font-semibold text-ink lg:text-[clamp(.95rem,1.1vw,1.45rem)]">{d.name}</p>
          <p className="text-xs text-muted lg:text-[clamp(.7rem,.8vw,1.05rem)]">
            {has ? (
              <>
                مكتمل <span className="num">{d.counts.works.completed}</span> من <span className="num">{d.counts.works.total}</span> مشروع ونشاط · <span className="num">{d.counts.tasks.completed}</span> من{' '}
                <span className="num">{d.counts.tasks.total}</span> مهمة
                {d.counts.tasks.late > 0 && (
                  <span className="text-late">
                    {' '}
                    · <span className="num">{d.counts.tasks.late}</span> متأخرة
                  </span>
                )}
              </>
            ) : (
              DATA_STATE[d.dataState]
            )}
          </p>
        </div>
        <span className="num relative shrink-0 font-bold text-ink text-[clamp(1.25rem,2vw,2.6rem)]">{has ? fmtPct(d.progress) : '—'}</span>
      </Tag>
    </li>
  );
}

function CountCard({ title, total, sub, rows }: { title: string; total: number; sub: string; rows: [string, number, string][] }) {
  return (
    <Card className="flex flex-col">
      <p className="text-sm text-muted lg:text-[clamp(.8rem,.95vw,1.2rem)]">{title}</p>
      <p className="num font-bold leading-tight text-ink text-[clamp(2rem,3.4vw,4.4rem)]">{fmtNum(total)}</p>
      <p className="text-xs text-muted lg:text-[clamp(.7rem,.8vw,1rem)]">{sub}</p>
      <div className="mt-auto pt-[1.4vh]">
        <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
          {rows.map(([l, n, c]) => (n ? <div key={l} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: c }} /> : null))}
        </div>
        <ul className="mt-2 grid grid-cols-3 gap-1 text-xs lg:text-[clamp(.72rem,.85vw,1.1rem)]">
          {rows.map(([l, n, c]) => (
            <li key={l}>
              <span className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {l}
              </span>
              <span className="num font-bold text-ink text-[1.35em]">{fmtNum(n)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// المحور التنفيذي
// ---------------------------------------------------------------------
function Executive({ exec }: { exec: NonNullable<ShareView['exec']> }) {
  if (!exec.hasPlan) return <Empty title="لا توجد خطة تنفيذية معتمدة لهذه السنة" body="يظهر هذا المحور بعد اعتماد الخطة التنفيذية ومؤشراتها." />;
  const c = exec.counts;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:gap-[2vh]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:gap-[1vw]">
        {(
          [
            ['المؤشرات', c.total, 'var(--ink)'],
            ['متحققة', c.achieved, 'var(--done)'],
            ['في المسار', c.onTrack, 'var(--teal)'],
            ['تحتاج انتباهًا', c.attention, 'var(--orange)'],
            ['بلا قياسات', c.noData, 'var(--nodata)'],
          ] as const
        ).map(([l, n, col]) => (
          <Card key={l} className="!py-3">
            <p className="text-sm text-muted lg:text-[clamp(.8rem,.9vw,1.15rem)]">{l}</p>
            <p className="num font-bold text-[clamp(1.6rem,2.6vw,3.4rem)]" style={{ color: col }}>
              {fmtNum(n)}
            </p>
          </Card>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)] lg:gap-[1.6vw]">
        <Card className="lg:min-h-0 lg:overflow-hidden">
          <h2 className="mb-[1.2vh] font-semibold text-ink lg:text-[clamp(1rem,1.1vw,1.4rem)]">الأهداف</h2>
          <ul className="flex flex-col gap-3 lg:gap-[1.4vh]">
            {exec.goals.map((g, i) => (
              <li key={g.id}>
                {g.axis && g.axis !== exec.goals[i - 1]?.axis && <p className="mb-1 text-xs font-semibold text-orange lg:text-[clamp(.7rem,.8vw,1rem)]">{g.axis}</p>}
                <div className="flex items-baseline justify-between gap-3">
                  <p className="line-clamp-2 text-sm text-text lg:text-[clamp(.8rem,.95vw,1.2rem)]">{g.title}</p>
                  <span className="num shrink-0 font-bold text-ink lg:text-[clamp(.9rem,1.1vw,1.4rem)]">{fmtPct(g.achievement)}</span>
                </div>
                <Bar value={g.achievement} color={g.achievement === null ? 'var(--nodata)' : g.achievement >= 95 ? 'var(--done)' : g.achievement >= 75 ? 'var(--teal)' : 'var(--orange)'} />
                <p className="mt-0.5 text-[11px] text-muted lg:text-[clamp(.65rem,.7vw,.9rem)]">{g.kpis} مؤشر · متوسط نسب التحقق</p>
              </li>
            ))}
            {exec.goals.length === 0 && <p className="text-sm text-muted">لا أهداف مسجلة.</p>}
          </ul>
        </Card>
        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:min-h-0 lg:gap-[1.2vw] xl:grid-cols-3">
          {exec.kpis.map((k) => (
            <KpiTile key={k.id} k={k} />
          ))}
          {exec.kpis.length === 0 && <Empty title="لا مؤشرات مختارة" />}
        </div>
      </div>
    </div>
  );
}

function KpiTile({ k }: { k: ShareKpi }) {
  const col = kpiColor[k.status];
  const unit = k.unit ? ` ${k.unit}` : k.kpiType === 'percentage' ? '٪' : '';
  return (
    <Card className="flex min-h-0 flex-col !p-[clamp(.75rem,1vw,1.4rem)]">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 font-semibold leading-snug text-ink lg:text-[clamp(.8rem,.95vw,1.25rem)]">{k.name}</p>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium lg:text-[clamp(.65rem,.7vw,.9rem)]" style={{ background: `color-mix(in oklab, ${col} 18%, transparent)`, color: col }}>
          {KPI_STATUS[k.status]}
        </span>
      </div>
      {k.goal && <p className="truncate text-[11px] text-muted lg:text-[clamp(.65rem,.72vw,.9rem)]">{k.goal}</p>}
      <div className="my-auto py-2">
        <p className="text-[11px] text-muted lg:text-[clamp(.65rem,.72vw,.9rem)]">نسبة التحقق</p>
        <p className="num font-bold leading-none text-[clamp(1.8rem,3vw,4.2rem)]" style={{ color: k.achievement === null ? 'var(--muted)' : col }}>
          {fmtPct(k.achievement)}
        </p>
      </div>
      <Bar value={k.achievement === null ? null : Math.min(100, Math.max(0, k.achievement))} color={col} />
      <div className="mt-2 flex items-end justify-between gap-2 text-[clamp(.75rem,.85vw,1.15rem)]">
        <p>
          <span className="text-muted">المتحقق </span>
          <span className="num font-semibold text-ink">{k.actual === null ? '—' : fmtNum(k.actual)}</span>
          <span className="text-muted">{k.actual === null ? '' : unit}</span>
        </p>
        <p>
          <span className="text-muted">المستهدف </span>
          <span className="num font-semibold text-ink">{fmtNum(k.target)}</span>
          <span className="text-muted">{unit}</span>
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// التعمق في إدارة (عند السماح بعرض أسماء المشاريع والأنشطة)
// ---------------------------------------------------------------------
function DrillPanel({ dept, onClose }: { dept: ShareDept; onClose: () => void }) {
  const acts = useMemo(() => [...(dept.activities ?? [])].sort((a, b) => b.progress - a.progress), [dept]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={dept.name}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-paper shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface p-5">
          <div>
            <h2 className="text-xl font-bold text-ink">{dept.name}</h2>
            <p className="text-sm text-muted">
              الإنجاز <span className="num font-semibold text-ink">{fmtPct(dept.progress)}</span> · المخطط <span className="num">{fmtPct(dept.planned)}</span> ·{' '}
              <span className="num">{dept.counts.works.total}</span> مشروع ونشاط · <span className="num">{dept.counts.tasks.total}</span> مهمة
            </p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="grid h-9 w-9 place-items-center rounded-full hover:bg-sunken">
            <X size={18} />
          </button>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-5">
          {acts.length === 0 && <li className="text-sm text-muted">لا توجد تفاصيل متاحة.</li>}
          {acts.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{a.title}</p>
                  <p className="text-xs text-muted">
                    {a.kind === 'project' ? 'مشروع' : 'نشاط'} · {ACTIVITY_STATE[a.state]} · <span className="num">{a.tasksDone}</span> من <span className="num">{a.tasksTotal}</span> مهام مكتملة
                    {a.tasksLate > 0 && <span className="text-late"> · {a.tasksLate} متأخرة</span>}
                  </p>
                </div>
                <span className="num shrink-0 text-lg font-bold text-ink">{fmtPct(a.progress)}</span>
              </div>
              <div className="mt-2">
                <Bar value={a.progress} planned={a.planned} color={pctColor(a.progress, a.planned)} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('card p-4 shadow-[var(--shadow)] lg:p-[clamp(1rem,1.3vw,1.8rem)]', className)}>{children}</section>;
}

function Bar({ value, planned, color, thick }: { value: number | null; planned?: number | null; color: string; thick?: boolean }) {
  return (
    <div className={cn('relative overflow-visible rounded-full bg-sunken', thick ? 'h-3 lg:h-[1.3vh]' : 'h-2')}>
      {value !== null && <div className="settle absolute inset-y-0 right-0 rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />}
      {planned !== null && planned !== undefined && planned > 0 && (
        <div className="absolute -inset-y-1 w-[3px] rounded-full bg-ink" style={{ right: `calc(${Math.min(100, planned)}% - 1.5px)` }} title={`المخطط ${fmtPct(planned)}`} />
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-line p-8 text-center">
      <div>
        <p className="text-lg font-semibold text-ink lg:text-[clamp(1.1rem,1.4vw,1.8rem)]">{title}</p>
        {body && <p className="mt-1 text-muted">{body}</p>}
      </div>
    </div>
  );
}
