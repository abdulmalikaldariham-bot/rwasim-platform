'use client';
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Expand, FolderKanban, KeyRound, ListChecks, Minimize, RefreshCw, Target, TriangleAlert, Wifi, WifiOff, X } from 'lucide-react';
import type { DisplayDept, DisplayKpi, DisplayModel, DisplayResult } from '@/lib/display/build';

const WIDE_QUERY = '(min-width: 1024px) and (orientation: landscape)';
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function readWide() {
  return window.matchMedia(WIDE_QUERY).matches;
}

const QL = ['', 'الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'];
const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${nf.format(n)}٪`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(n));
const tf = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' });

const KPI_STATUS: Record<string, [string, string]> = {
  achieved: ['متحقق', '#7fe0b8'],
  on_track: ['في المسار', '#8fd3e0'],
  at_risk: ['يحتاج انتباهًا', '#f4a63f'],
  off_track: ['منحرف', '#ff8f84'],
  no_data: ['لا توجد قياسات', '#9fb6c0'],
  no_target: ['بلا مستهدف', '#9fb6c0'],
};
const ACT_STATE: Record<string, string> = { completed: 'مكتمل', stalled: 'متعثر', late: 'متأخر', in_progress: 'جارٍ', not_started: 'لم يبدأ', upcoming: 'قادم' };

function Ring({ value, planned, size }: { value: number | null; planned: number | null; size: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const p = planned === null ? null : Math.max(0, Math.min(100, planned));
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }} className="-rotate-90" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#ffffff1a" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="url(#rg)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray 900ms ease' }} />
      {p !== null && p > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke="#ffffff" strokeWidth="11" strokeDasharray={`1.2 ${c}`} strokeDashoffset={-((p / 100) * c) + 0.6} />}
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4a63f" />
          <stop offset="100%" stopColor="#ef9122" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Glass({ className = '', children, onClick }: { className?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <section
      onClick={onClick}
      className={`rounded-[1.4em] border border-white/10 bg-gradient-to-b from-white/[0.075] to-white/[0.03] shadow-[0_20px_40px_-30px_#000] backdrop-blur-sm ${onClick ? 'cursor-pointer transition hover:border-white/25' : ''} ${className}`}
    >
      {children}
    </section>
  );
}

function H({ icon, children, aside }: { icon?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-[0.7em] flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-[0.45em] text-[1.05em] font-bold text-white">
        {icon && <span className="text-[#f4a63f]">{icon}</span>}
        {children}
      </h2>
      {aside}
    </div>
  );
}

function Count({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="num text-[1.9em] leading-none font-bold" style={{ color: color ?? '#fff', textAlign: 'right' }}>
        {num(value)}
      </p>
      <span className="mt-[0.35em] block h-[3px] w-[1.6em] rounded-full bg-[#ef9122]" />
      <p className="mt-[0.35em] truncate text-[0.78em] text-[#b6ccd6]">{label}</p>
    </div>
  );
}

function DeptRow({ d, onOpen }: { d: DisplayDept; onOpen?: () => void }) {
  const has = d.progress !== null;
  const behind = has && d.planned !== null && d.progress! + 10 < d.planned!;
  const color = !has ? 'transparent' : d.progress! >= 100 ? '#4fbf97' : behind ? '#ef9122' : '#74b7c5';
  return (
    <button type="button" onClick={onOpen} disabled={!has || !onOpen} className="group block w-full text-right disabled:cursor-default">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[0.95em] font-semibold text-white">{d.name}</span>
        {has ? (
          <span className="num shrink-0 text-[1.25em] font-bold">{pct(d.progress)}</span>
        ) : (
          <span className="shrink-0 rounded-full bg-white/10 px-[0.7em] py-[0.1em] text-[0.7em] text-[#b6ccd6]">{d.status === 'not_approved' ? 'الخطة غير معتمدة بعد' : 'لا توجد خطة'}</span>
        )}
      </div>
      <div className="relative mt-[0.35em] h-[0.6em] overflow-hidden rounded-full bg-white/10">
        {has && <div className="absolute inset-y-0 right-0 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, d.progress!)}%`, background: color }} />}
        {has && d.planned !== null && d.planned > 0 && <div className="absolute inset-y-[-2px] w-[3px] rounded-full bg-white" style={{ right: `calc(${Math.min(100, d.planned)}% - 1.5px)` }} />}
      </div>
      {has && (
        <p className="mt-[0.3em] text-[0.72em] text-[#a2becf]">
          {d.unitsCompleted}/{d.units} مشاريع وأنشطة مكتملة · {d.stepsCompleted}/{d.steps} مهام
          {d.stepsLate > 0 && <span className="text-[#f4a63f]"> · {d.stepsLate} متأخرة</span>}
          {onOpen && <span className="opacity-0 transition group-hover:opacity-100"> · التفاصيل ←</span>}
        </p>
      )}
    </button>
  );
}

function KpiTile({ k }: { k: DisplayKpi }) {
  const [label, color] = KPI_STATUS[k.status] ?? KPI_STATUS.no_data;
  const unit = k.unit ? ` ${k.unit}` : k.kpiType === 'percentage' ? '٪' : '';
  const ach = k.achievement === null ? null : Math.max(0, Math.min(100, k.achievement));
  return (
    <div className="flex min-h-0 flex-col justify-between rounded-[1em] border border-white/10 bg-white/[0.04] p-[0.75em]">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[0.82em] leading-snug font-semibold text-white">{k.name}</p>
        <span className="shrink-0 rounded-full px-[0.6em] py-[0.1em] text-[0.62em] font-bold" style={{ background: `${color}26`, color }}>
          {label}
        </span>
      </div>
      <div className="mt-[0.5em] flex items-end justify-between gap-2">
        <p className="num text-[1.45em] leading-none font-bold text-white" style={{ textAlign: 'right' }}>
          {num(k.actual)}
          <span className="text-[0.5em] font-normal text-[#a2becf]">{k.actual === null ? '' : unit}</span>
        </p>
        <p className="text-left text-[0.64em] leading-tight text-[#a2becf]">
          المستهدف <span className="num font-semibold text-white">{num(k.target)}</span>
          {unit}
          <br />
          التحقق <span className="num font-bold" style={{ color }}>{pct(k.achievement)}</span>
        </p>
      </div>
      <div className="mt-[0.45em] h-[0.4em] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${ach ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}

export function DisplayBoard({ token, initial }: { token: string; initial: DisplayResult }) {
  const [result, setResult] = useState<DisplayResult>(initial);
  const [model, setModel] = useState<DisplayModel | null>(initial.status === 'ok' ? initial : null);
  const [lastOk, setLastOk] = useState<string | null>(initial.status === 'ok' ? new Date().toISOString() : null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState(() => {
    if (typeof window === 'undefined' || initial.status !== 'code_required') return '';
    try {
      return sessionStorage.getItem(`display-code-${token}`) ?? '';
    } catch {
      return '';
    }
  });
  const [codeInput, setCodeInput] = useState('');
  const [period, setPeriod] = useState<{ year?: number; quarter?: number }>({});
  const [busy, setBusy] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, readWide, () => true);
  const [screenPref, setScreenPref] = useState<boolean | null>(null);
  const screen = screenPref ?? wide;
  const [isFull, setIsFull] = useState(false);
  const [openDept, setOpenDept] = useState<DisplayDept | null>(null);
  const [goalFilter, setGoalFilter] = useState<string | null>(null);
  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const fetchData = useCallback(
    async (opts?: { code?: string; year?: number; quarter?: number }) => {
      setBusy(true);
      try {
        const r = await fetch(`/api/display/${token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: opts?.code ?? codeRef.current, year: opts?.year ?? period.year, quarter: opts?.quarter ?? period.quarter }),
          cache: 'no-store',
        });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as DisplayResult;
        setResult(data);
        if (data.status === 'ok') {
          setModel(data);
          setLastOk(new Date().toISOString());
          setFailed(false);
        } else if (data.status === 'error') setFailed(true);
        else setModel(null);
        return data;
      } catch {
        setFailed(true);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [token, period.year, period.quarter],
  );

  // استعادة رمز الوصول المحفوظ لهذه الجلسة (مرة واحدة)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || initial.status !== 'code_required' || !codeRef.current) return;
    restored.current = true;
    void fetchData({ code: codeRef.current });
  }, [initial.status, fetchData]);

  // التحديث التلقائي
  const refresh = model?.link.refreshSeconds ?? 300;
  useEffect(() => {
    if (!model) return;
    const t = setInterval(() => void fetchData(), refresh * 1000);
    return () => clearInterval(t);
  }, [model, refresh, fetchData]);

  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = await fetchData({ code: codeInput });
    if (d?.status === 'ok') {
      setCode(codeInput);
      try {
        sessionStorage.setItem(`display-code-${token}`, codeInput);
      } catch {}
    }
  };

  const kpis = useMemo(() => (model?.exec ? model.exec.kpis.filter((k) => !goalFilter || k.goalId === goalFilter) : []), [model, goalFilter]);

  // ---------- حالات غير العرض ----------
  if (!model) {
    const st = result.status;
    const msg: Record<string, [string, string]> = {
      invalid: ['الرابط غير صالح', 'قد يكون الرابط أُلغي أو أُدخل بصورة غير صحيحة. تواصل مع الجمعية للحصول على رابط محدث.'],
      expired: ['انتهت صلاحية الرابط', 'هذا الرابط لم يعد متاحًا. تواصل مع الجمعية للحصول على رابط جديد.'],
      locked: ['محاولات كثيرة', 'أُوقف الدخول مؤقتًا بعد عدة محاولات غير صحيحة. حاول بعد ربع ساعة.'],
      error: ['تعذر تحميل البيانات', 'حدث خطأ في الاتصال. سيُعاد المحاولة تلقائيًا.'],
    };
    const needCode = st === 'code_required' || st === 'code_invalid';
    return (
      <main className="hero grid min-h-dvh place-items-center px-4 text-white">
        <div className="w-full max-w-md text-center">
          <img src="/brand/logo-white.png" alt="جمعية رواسم" className="mx-auto mb-8 w-44" />
          {needCode ? (
            <form onSubmit={submitCode} className="rounded-[1.6rem] border border-white/10 bg-white/[0.06] p-7 text-right backdrop-blur">
              <p className="mb-1 flex items-center gap-2 text-lg font-bold">
                <KeyRound size={18} className="text-[#f4a63f]" /> لوحة الأداء المؤسسي
              </p>
              <p className="mb-5 text-sm text-[#b6ccd6]">هذا الرابط محمي برمز وصول. أدخل الرمز الذي زودتك به الجمعية.</p>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                autoFocus
                type="password"
                className="h-12 w-full rounded-full border border-white/20 bg-white/10 px-5 text-center text-lg tracking-widest text-white outline-none focus:border-[#f4a63f]"
                aria-label="رمز الوصول"
              />
              {st === 'code_invalid' && <p className="mt-2 text-sm text-[#f4a63f]">الرمز غير صحيح.</p>}
              <button disabled={busy || !codeInput} className="mt-4 h-12 w-full rounded-full bg-[#ef9122] font-bold text-[#2b1700] disabled:opacity-50">
                {busy ? 'جارٍ التحقق…' : 'عرض اللوحة'}
              </button>
            </form>
          ) : (
            <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.06] p-7">
              <p className="text-xl font-bold">{(msg[st] ?? msg.invalid)[0]}</p>
              <p className="mt-2 text-sm text-[#b6ccd6]">{(msg[st] ?? msg.invalid)[1]}</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  const m = model;
  const s = m.link.sections;
  const showOps = s.ops !== false;
  const showExec = !!m.exec;
  const opsValue = m.ops.computable ? m.ops.progress : m.ops.partial;
  const fsSize = screen ? 'clamp(11px, min(0.98vw, 1.75vh), 30px)' : '15px';

  return (
    <main className={`hero relative text-white ${screen ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`} style={{ fontSize: fsSize }}>
      <div className={`flex flex-col gap-[1em] p-[1.4em] ${screen ? 'h-full' : ''}`}>
        {/* الترويسة */}
        <header className="flex flex-wrap items-center justify-between gap-[1em]">
          <div className="flex items-center gap-[1em]">
            <img src="/brand/logo-white.png" alt="جمعية رواسم" className="h-[3.4em] w-auto" />
            <div className="border-s border-white/15 ps-[1em]">
              <h1 className="font-display text-[1.7em] leading-tight font-bold">لوحة الأداء المؤسسي</h1>
              <p className="text-[0.85em] text-[#b6ccd6]">
                {m.link.name} · {QL[m.period.quarter]} {m.period.year}م
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-[0.6em] text-[0.8em]">
            {m.link.allowNav && (
              <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1">
                <select
                  aria-label="السنة"
                  value={m.period.year}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setPeriod((p) => ({ ...p, year: y }));
                    void fetchData({ year: y });
                  }}
                  className="rounded-full bg-transparent px-2 py-1 text-white outline-none [&>option]:text-black"
                >
                  {m.years.map((y) => (
                    <option key={y} value={y}>
                      {y}م
                    </option>
                  ))}
                </select>
                {[1, 2, 3, 4].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setPeriod((p) => ({ ...p, quarter: q }));
                      void fetchData({ quarter: q });
                    }}
                    className={`rounded-full px-[0.8em] py-[0.25em] ${q === m.period.quarter ? 'bg-[#ef9122] font-bold text-[#2b1700]' : 'text-[#b6ccd6] hover:text-white'}`}
                  >
                    ر{q}
                  </button>
                ))}
              </div>
            )}
            <span className={`flex items-center gap-[0.4em] rounded-full px-[0.8em] py-[0.35em] ${failed ? 'bg-[#ef9122]/20 text-[#f4a63f]' : 'bg-white/5 text-[#b6ccd6]'}`} role="status">
              {failed ? <WifiOff size={14} /> : <Wifi size={14} className="text-[#7fe0b8]" />}
              {failed ? 'تعذر التحديث — تُعرض آخر بيانات ناجحة' : 'مباشر'}
              <span className="text-white/70">· آخر تحديث {lastOk ? tf.format(new Date(lastOk)) : '—'}</span>
            </span>
            <button onClick={() => void fetchData()} className="rounded-full bg-white/5 p-[0.55em] hover:bg-white/10" aria-label="تحديث الآن" title="تحديث الآن">
              <RefreshCw size={15} className={busy ? 'animate-spin' : undefined} />
            </button>
            <button onClick={() => setScreenPref(!screen)} className="hidden rounded-full bg-white/5 px-[0.9em] py-[0.4em] hover:bg-white/10 lg:block">
              {screen ? 'عرض قابل للتمرير' : 'وضع الشاشة'}
            </button>
            <button onClick={toggleFull} className="rounded-full bg-white/5 p-[0.55em] hover:bg-white/10" aria-label="ملء الشاشة" title="ملء الشاشة">
              {isFull ? <Minimize size={15} /> : <Expand size={15} />}
            </button>
          </div>
        </header>

        {/* المحتوى */}
        <div className={`grid min-h-0 flex-1 gap-[1em] ${showExec && showOps ? 'lg:grid-cols-[1.32fr_1fr]' : ''}`}>
          {showOps && (
            <div className={`grid min-h-0 gap-[1em] ${screen ? 'grid-rows-[auto_minmax(0,1fr)]' : ''}`}>
              {/* الأداء التشغيلي: الرقم الرئيس والعدادات */}
              <Glass className="p-[1.2em]">
                <div className="flex flex-wrap items-center gap-[1.4em]">
                  <div className="relative grid place-items-center">
                    <Ring value={opsValue} planned={m.ops.planned} size="9.5em" />
                    <div className="absolute text-center">
                      <p className="num text-[2.3em] leading-none font-bold">{pct(opsValue)}</p>
                      <p className="mt-[0.2em] text-[0.68em] text-[#b6ccd6]">{m.ops.computable ? 'إنجاز الخطة التشغيلية' : 'مؤشر جزئي'}</p>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 basis-[20em]">
                    <p className="text-[0.75em] font-semibold tracking-wide text-[#f4a63f]">الأداء التشغيلي</p>
                    <p className="font-display text-[1.25em] font-bold">إجمالي إنجاز الخطة التشغيلية للجمعية</p>
                    <p className="mt-[0.2em] text-[0.8em] text-[#b6ccd6]">
                      المخطط حتى اليوم <span className="num font-bold text-white">{pct(m.ops.planned)}</span>
                      {opsValue !== null && m.ops.planned !== null && (
                        <>
                          {' '}· الفارق{' '}
                          <span className="num font-bold" style={{ color: opsValue >= m.ops.planned - 5 ? '#7fe0b8' : '#f4a63f' }}>
                            {pct(Math.round((opsValue - m.ops.planned) * 10) / 10)}
                          </span>
                        </>
                      )}
                    </p>
                    {!m.ops.computable && m.ops.missing.length > 0 && <p className="mt-[0.2em] text-[0.72em] text-[#f4a63f]">بانتظار اعتماد خطط: {m.ops.missing.join('، ')}</p>}
                    <div className="mt-[0.9em] grid grid-cols-1 gap-[0.9em] sm:grid-cols-[1fr_auto_1fr]">
                      <div>
                        <p className="mb-[0.4em] flex items-center gap-[0.35em] text-[0.75em] font-bold text-[#dcebf2]">
                          <FolderKanban size={14} className="text-[#f4a63f]" /> المشاريع والأنشطة
                        </p>
                        <div className="grid grid-cols-4 gap-[0.6em]">
                          <Count label="الإجمالي" value={m.ops.counts.units} />
                          <Count label="مكتملة" value={m.ops.counts.unitsCompleted} color="#7fe0b8" />
                          <Count label="جارية" value={m.ops.counts.unitsInProgress} color="#8fd3e0" />
                          <Count label="متأخرة" value={m.ops.counts.unitsLate} color={m.ops.counts.unitsLate ? '#f4a63f' : undefined} />
                        </div>
                      </div>
                      <span className="hidden w-px bg-white/10 sm:block" />
                      <div>
                        <p className="mb-[0.4em] flex items-center gap-[0.35em] text-[0.75em] font-bold text-[#dcebf2]">
                          <ListChecks size={14} className="text-[#f4a63f]" /> المهام التنفيذية
                        </p>
                        <div className="grid grid-cols-3 gap-[0.6em]">
                          <Count label="الإجمالي" value={m.ops.counts.steps} />
                          <Count label="مكتملة" value={m.ops.counts.stepsCompleted} color="#7fe0b8" />
                          <Count label="متأخرة" value={m.ops.counts.stepsLate} color={m.ops.counts.stepsLate ? '#f4a63f' : undefined} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Glass>

              <div className={`grid min-h-0 gap-[1em] ${s.curve && s.departments ? 'md:grid-cols-[1fr_1.05fr]' : ''}`}>
                {s.departments && m.depts.length > 0 && (
                  <Glass className="flex min-h-0 flex-col p-[1.2em]">
                    <H aside={<span className="flex items-center gap-1 text-[0.68em] text-[#a2becf]"><span className="inline-block h-[0.9em] w-[3px] rounded bg-white" /> المخطط حتى اليوم</span>}>نسب إنجاز الإدارات</H>
                    <div className={`flex min-h-0 flex-1 flex-col gap-[0.9em] ${screen ? 'justify-around' : ''}`}>
                      {m.depts.map((d) => (
                        <DeptRow key={d.id} d={d} onOpen={d.activities.length ? () => setOpenDept(d) : undefined} />
                      ))}
                    </div>
                  </Glass>
                )}
                {s.curve && (
                  <Glass className="flex min-h-0 flex-col p-[1.2em]">
                    <H>المخطط مقابل المتحقق</H>
                    <div className="min-h-[12em] flex-1" dir="ltr">
                      {m.ops.curve.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={m.ops.curve} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                            <defs>
                              <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ef9122" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="#ef9122" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#ffffff14" vertical={false} />
                            <XAxis dataKey="label" reversed tick={{ fill: '#a2becf', fontSize: '0.7em' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
                            <YAxis orientation="right" domain={[0, 100]} tick={{ fill: '#a2becf', fontSize: '0.7em' }} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={38} />
                            <Tooltip contentStyle={{ background: '#0b2733', border: '1px solid #ffffff22', borderRadius: 12, direction: 'rtl', color: '#fff' }} formatter={(v, n) => [`${v}%`, n === 'planned' ? 'المخطط' : 'المتحقق']} />
                            <Area type="monotone" dataKey="planned" stroke="#a2becf" strokeDasharray="5 4" strokeWidth={2} fill="none" isAnimationActive={false} />
                            <Area type="monotone" dataKey="actual" stroke="#ef9122" strokeWidth={3} fill="url(#ga)" connectNulls={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="grid h-full place-items-center text-[0.85em] text-[#a2becf]">لا توجد خطط معتمدة لهذا الربع بعد.</p>
                      )}
                    </div>
                    <div className="mt-[0.6em] grid grid-cols-4 gap-[0.5em] border-t border-white/10 pt-[0.6em]">
                      {m.ops.quarters.map((q) => (
                        <div key={q.q} className={`rounded-[0.8em] px-[0.5em] py-[0.3em] text-center ${q.q === m.period.quarter ? 'bg-white/10' : ''}`}>
                          <p className="text-[0.64em] text-[#a2becf]">{QL[q.q]}</p>
                          <p className="num text-[1em] font-bold">{q.hasPlans ? pct(q.value) : '—'}</p>
                        </div>
                      ))}
                    </div>
                  </Glass>
                )}
              </div>
            </div>
          )}

          {showExec && m.exec && (
            <div className={`grid min-h-0 gap-[1em] ${screen ? 'grid-rows-[auto_minmax(0,1fr)]' : ''}`}>
              <Glass className="p-[1.2em]">
                <p className="text-[0.75em] font-semibold tracking-wide text-[#f4a63f]">الأداء التنفيذي السنوي</p>
                <H icon={<Target size={16} />} aside={goalFilter && <button onClick={() => setGoalFilter(null)} className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[0.7em]"><X size={12} /> كل الأهداف</button>}>
                  الأهداف التنفيذية الكبرى
                </H>
                {m.exec.goals.length === 0 ? (
                  <p className="text-[0.85em] text-[#a2becf]">لا توجد أهداف في الخطة التنفيذية المعتمدة.</p>
                ) : (
                  <ul className={`space-y-[0.45em] ${screen ? 'max-h-[17em] overflow-hidden' : ''}`}>
                    {m.exec.goals.slice(0, screen ? 5 : 50).map((g) => (
                      <li key={g.id}>
                        <button type="button" onClick={() => setGoalFilter(goalFilter === g.id ? null : g.id)} className={`block w-full rounded-[0.8em] px-[0.4em] py-[0.15em] text-right transition ${goalFilter === g.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="line-clamp-1 text-[0.88em] font-semibold">{g.title}</span>
                            <span className="num shrink-0 text-[1em] font-bold">{pct(g.progress)}</span>
                          </div>
                          <div className="mt-[0.3em] h-[0.45em] overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-gradient-to-l from-[#f4a63f] to-[#ef9122] transition-[width] duration-700" style={{ width: `${g.progress ?? 0}%` }} />
                          </div>
                          <p className="mt-[0.2em] text-[0.65em] text-[#a2becf]">
                            {g.axis ? `${g.axis} · ` : ''}
                            {g.kpiCount} مؤشرات · {g.achieved} متحققة
                          </p>
                        </button>
                      </li>
                    ))}
                    {screen && m.exec.goals.length > 5 && <li className="text-[0.7em] text-[#a2becf]">و{m.exec.goals.length - 5} أهداف أخرى</li>}
                  </ul>
                )}
              </Glass>
              <Glass className="flex min-h-0 flex-col p-[1.2em]">
                <H aside={<span className="text-[0.7em] text-[#a2becf]">{m.exec.totalKpis > kpis.length && !goalFilter ? `أهم ${kpis.length} من ${m.exec.totalKpis}` : `${kpis.length} مؤشرات`}</span>}>مؤشرات الأداء السنوية</H>
                {kpis.length === 0 ? (
                  <p className="text-[0.85em] text-[#a2becf]">لا توجد مؤشرات للعرض.</p>
                ) : (
                  <div className={`grid min-h-0 flex-1 gap-[0.7em] ${kpis.length > 4 ? 'sm:grid-cols-2' : ''} ${screen ? 'auto-rows-fr' : ''}`}>
                    {kpis.map((k) => (
                      <KpiTile key={k.id} k={k} />
                    ))}
                  </div>
                )}
              </Glass>
            </div>
          )}

          {!showOps && !showExec && (
            <Glass className="grid place-items-center p-10 text-center text-[#a2becf]">لم تُحدد بيانات للعرض في هذا الرابط.</Glass>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 text-[0.7em] text-[#a2becf]">
          <span>
            {m.orgName} · منصة الأداء المؤسسي — بيانات الخطط المعتمدة فقط
          </span>
          <span>يتحدث تلقائيًا كل {m.link.refreshSeconds >= 60 ? `${Math.round(m.link.refreshSeconds / 60)} دقائق` : `${m.link.refreshSeconds} ثانية`}</span>
        </footer>
      </div>

      {openDept && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#020b10]/70 p-4 backdrop-blur-sm" onClick={() => setOpenDept(null)} role="dialog" aria-modal>
          <div className="hero max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-[1.6rem] border border-white/15 p-6 text-[15px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-[#f4a63f]">تفاصيل الإدارة</p>
                <h2 className="font-display text-2xl font-bold">{openDept.name}</h2>
                <p className="mt-1 text-sm text-[#b6ccd6]">
                  الإنجاز <span className="num font-bold text-white">{pct(openDept.progress)}</span> · المخطط <span className="num">{pct(openDept.planned)}</span> · {openDept.stepsCompleted}/{openDept.steps} مهام مكتملة
                </p>
              </div>
              <button onClick={() => setOpenDept(null)} className="rounded-full bg-white/10 p-2" aria-label="إغلاق">
                <X size={18} />
              </button>
            </div>
            <ul className="space-y-3">
              {openDept.activities.map((a, i) => (
                <li key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{a.title ?? `${a.kind === 'project' ? 'مشروع' : 'نشاط'} ${i + 1}`}</span>
                    <span className="num font-bold">{pct(a.progress)}</span>
                  </div>
                  <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${a.progress}%`, background: a.state === 'completed' ? '#4fbf97' : a.state === 'late' || a.state === 'stalled' ? '#ef9122' : '#74b7c5' }} />
                  </div>
                  <p className="mt-1 text-xs text-[#a2becf]">
                    {a.kind === 'project' ? 'مشروع' : 'نشاط'} · {ACT_STATE[a.state]} · {a.stepsCompleted}/{a.stepsTotal} مهام
                  </p>
                </li>
              ))}
            </ul>
            {!m.link.sections.activity_titles && (
              <p className="mt-4 flex items-center gap-2 text-xs text-[#a2becf]">
                <TriangleAlert size={13} /> أسماء المشاريع والأنشطة غير مشمولة في هذا الرابط.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
