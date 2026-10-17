// وثيقة التقرير — مكوّن نقي يُعرض في الصفحة ويُحوَّل إلى PDF بالمحتوى نفسه
import type { ReportSnapshot } from './build';
import { DATA_STATE, KPI_STATUS, MONTHS, QUARTER_LABEL, REPORT_TYPE } from '../labels';

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 10) / 10}٪`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n));
const date = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(d.length === 10 ? d + 'T12:00:00Z' : d)) : '—';

export const REPORT_CSS = `
.rp{--ink:#013047;--teal:#326e7c;--orange:#f09223;--line:#d7e2e4;--muted:#5b7380;--soft:#eef4f5;--done:#2c8a6a;--late:#d9771a;--bad:#b8443c;
font-family:'IBM Plex Sans Arabic',sans-serif;color:#0d2b3a;direction:rtl;background:#fff;line-height:1.6;font-size:12.5px;font-variant-numeric:tabular-nums}
.rp *{box-sizing:border-box}
.rp .page{max-width:820px;margin:0 auto;padding:28px 34px}
.rp header.cover{border-bottom:3px solid var(--ink);padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.rp .brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:700}
.rp .brand small{display:block;font-weight:400;color:var(--muted);font-size:11px}
.rp h1{font-size:22px;color:var(--ink);margin:6px 0 0}
.rp h2{font-size:15px;color:var(--ink);margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.rp h3{font-size:13px;color:var(--teal);margin:12px 0 6px}
.rp .meta{color:var(--muted);font-size:11px;text-align:left}
.rp .hero{display:grid;grid-template-columns:200px 1fr;gap:18px;align-items:center;background:var(--soft);border-radius:10px;padding:16px 18px}
.rp .big{font-size:40px;font-weight:700;color:var(--ink);direction:ltr;text-align:right}
.rp .muted{color:var(--muted)}
.rp table{width:100%;border-collapse:collapse;margin-top:4px}
.rp th{background:var(--ink);color:#fff;font-weight:600;font-size:11.5px;padding:6px 8px;text-align:right}
.rp td{border-bottom:1px solid var(--line);padding:6px 8px;vertical-align:top}
.rp tr:nth-child(even) td{background:#fafcfc}
.rp .bar{position:relative;height:9px;background:#e4ecee;border-radius:9px;overflow:hidden;min-width:120px}
.rp .bar i{position:absolute;inset-block:0;right:0;border-radius:9px;background:var(--teal)}
.rp .bar b{position:absolute;inset-block:0;width:2px;background:var(--ink)}
.rp .pill{display:inline-block;border-radius:20px;padding:1px 8px;font-size:11px;background:#e8eef0}
.rp .ok{color:var(--done)} .rp .warn{color:var(--late)} .rp .bad{color:var(--bad)}
.rp ul.facts{margin:4px 0;padding-inline-start:18px}
.rp .comment{border-inline-start:4px solid var(--orange);background:#fdf6ec;padding:10px 14px;border-radius:6px;white-space:pre-wrap}
.rp .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.rp .box{border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.rp .box .v{font-size:18px;font-weight:700;color:var(--ink)}
.rp footer{margin-top:26px;padding-top:8px;border-top:1px solid var(--line);color:var(--muted);font-size:10.5px;display:flex;justify-content:space-between}
.rp .avoid{break-inside:avoid}
@media print{.rp .page{padding:0;max-width:none}}
`;

function Bar({ v, planned }: { v: number | null; planned?: number | null }) {
  return (
    <div className="bar">
      {v !== null && <i style={{ width: `${Math.min(100, v)}%` }} />}
      {planned !== null && planned !== undefined && planned > 0 && <b style={{ right: `calc(${Math.min(100, planned)}% - 1px)` }} />}
    </div>
  );
}

const statusClass = (s: string) => (s === 'achieved' || s === 'on_track' ? 'ok' : s === 'at_risk' ? 'warn' : s === 'off_track' ? 'bad' : 'muted');

export function ReportDocument({
  snap,
  title,
  status,
  comment,
  generatedByName,
  approvedByName,
  approvedAt,
}: {
  snap: ReportSnapshot;
  title: string;
  status: 'draft' | 'approved';
  comment: string | null;
  generatedByName: string;
  approvedByName?: string | null;
  approvedAt?: string | null;
}) {
  const o = snap.operational;
  const m = snap.meta;
  return (
    <div className="rp">
      <div className="page">
        <header className="cover">
          <div>
            <div className="brand">
              <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
                <rect x="3" y="5" width="26" height="5" rx="2.5" fill="#f09223" />
                <rect x="6" y="13.5" width="23" height="5" rx="2.5" fill="#326e7c" />
                <rect x="3" y="22" width="20" height="5" rx="2.5" fill="#013047" />
              </svg>
              <span>
                جمعية رواسم
                <small>منصة الأداء المؤسسي</small>
              </span>
            </div>
            <h1>{title}</h1>
            <p className="muted" style={{ margin: 0 }}>
              التقرير {REPORT_TYPE[m.type]} — {m.periodLabel}
              {m.departmentName ? ` — ${m.departmentName}` : ' — الجمعية كاملة'}
            </p>
          </div>
          <div className="meta">
            {status === 'approved' ? <strong style={{ color: '#2c8a6a' }}>تقرير معتمد</strong> : <strong style={{ color: '#d9771a' }}>مسودة — بانتظار اعتماد المدير التنفيذي</strong>}
            <br />
            البيانات حتى {date(m.asOf)}
            <br />
            أصدره {generatedByName} في {date(m.generatedAt)}
            {approvedAt && (
              <>
                <br />
                اعتمده {approvedByName} في {date(approvedAt)}
              </>
            )}
          </div>
        </header>

        <section className="avoid">
          <h2>{m.type === 'annual' ? 'ملخص الأداء المؤسسي' : 'الإنجاز العام'}</h2>
          <div className="hero">
            <div>
              <div className="muted">{m.departmentName ? 'إنجاز خطة الإدارة' : 'إنجاز الخطة التشغيلية'}{m.type === 'annual' ? ' (آخر ربع)' : ''}</div>
              <div className="big">{o.computable ? pct(o.progress) : '—'}</div>
              {!o.computable && (
                <div className="warn">
                  غير قابل للاحتساب: {o.missingDepartments.join('، ') || 'لا توجد خطة معتمدة'}
                  {o.partialProgress !== null && <div>مؤشر جزئي للإدارات المعتمدة: {pct(o.partialProgress)}</div>}
                </div>
              )}
              <div className="muted">المخطط حتى تاريخ البيانات: {pct(o.planned)}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>الإدارة</th>
                  <th style={{ width: '38%' }}>الإنجاز</th>
                  <th>الأنشطة</th>
                  <th>حالة البيانات</th>
                </tr>
              </thead>
              <tbody>
                {o.departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Bar v={d.progress} planned={d.planned} />
                        <span style={{ minWidth: 42 }}>{d.progress === null ? 'لا توجد بيانات' : pct(d.progress)}</span>
                      </div>
                    </td>
                    <td>
                      {d.completed}/{d.activities}
                      {d.late + d.stalled > 0 && <span className="warn"> ({d.late + d.stalled} متأخرة)</span>}
                    </td>
                    <td>{DATA_STATE[d.dataState]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {o.quarters && (
          <section className="avoid">
            <h2>الإنجاز التشغيلي خلال الأرباع الأربعة</h2>
            <div className="grid4">
              {o.quarters.map((q) => (
                <div className="box" key={q.quarter}>
                  <div className="muted">{QUARTER_LABEL[q.quarter]}</div>
                  <div className="v">{!q.hasPlans ? '—' : q.computable ? pct(q.progress) : pct(q.partial)}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{!q.hasPlans ? 'لا توجد خطط' : q.computable ? 'مكتمل الاحتساب' : 'مؤشر جزئي'}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {o.months && (
          <section className="avoid">
            <h2>{m.type === 'monthly' ? 'أعمال الشهر' : 'مقارنة المخطط بالمتحقق حسب الأشهر'}</h2>
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>خطوات مجدولة</th>
                  <th>منجزة</th>
                  <th>متأخرة</th>
                </tr>
              </thead>
              <tbody>
                {o.months.map((x) => (
                  <tr key={x.month}>
                    <td>{MONTHS[x.month]}</td>
                    <td>{x.scheduled}</td>
                    <td className="ok">{x.done}</td>
                    <td className={x.late ? 'warn' : ''}>{x.late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h2>{m.type === 'annual' ? 'أبرز المنجزات' : m.type === 'quarterly' ? 'أهم المبادرات المنجزة' : 'أبرز الأعمال المنجزة'}</h2>
          {snap.completedActivities.length > 0 && (
            <>
              <h3>أنشطة مكتملة</h3>
              <ul className="facts">
                {snap.completedActivities.map((a, i) => (
                  <li key={i}>
                    {a.activity} <span className="muted">— {a.department}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {snap.achievements.length === 0 ? (
            <p className="muted">لم تُسجل خطوات مكتملة في هذه الفترة.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الخطوة المنجزة</th>
                  <th>النشاط</th>
                  <th>الإدارة</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {snap.achievements.map((a, i) => (
                  <tr key={i}>
                    <td>{a.step}</td>
                    <td>{a.activity}</td>
                    <td>{a.department}</td>
                    <td>{date(a.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>الأعمال المتأخرة</h2>
          {snap.lateItems.length === 0 ? (
            <p className="ok">لا توجد أعمال متأخرة حتى تاريخ البيانات.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الخطوة</th>
                  <th>النشاط</th>
                  <th>الإدارة</th>
                  <th>المسؤول</th>
                  <th>الموعد</th>
                  <th>التأخر</th>
                </tr>
              </thead>
              <tbody>
                {snap.lateItems.map((a, i) => (
                  <tr key={i}>
                    <td>{a.step}</td>
                    <td>{a.activity}</td>
                    <td>{a.department}</td>
                    <td>{a.responsible ?? '—'}</td>
                    <td>{date(a.dueDate)}</td>
                    <td className="warn">{a.daysLate} يومًا</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>{m.type === 'annual' ? 'تحقيق الأهداف التنفيذية ونتائج المؤشرات' : 'تقدم مؤشرات الأداء السنوية'}</h2>
          {snap.kpis.length === 0 ? (
            <p className="muted">لا توجد خطة تنفيذية معتمدة لهذه السنة.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الهدف</th>
                  <th>المؤشر</th>
                  <th>المستهدف</th>
                  <th>المتحقق</th>
                  <th>نسبة التحقق</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {snap.kpis.map((k, i) => (
                  <tr key={i}>
                    <td>{k.goal}</td>
                    <td>
                      {k.name}
                      {k.department && <div className="muted">{k.department}</div>}
                    </td>
                    <td>
                      {num(k.target)} {k.unit ?? ''}
                    </td>
                    <td>
                      {num(k.actual)} {k.actual !== null ? k.unit ?? '' : ''}
                    </td>
                    <td>{pct(k.achievement)}</td>
                    <td className={statusClass(k.status)}>{KPI_STATUS[k.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {snap.comparison && snap.comparison.length > 0 && (
          <section className="avoid">
            <h2>مقارنة بالسنوات السابقة</h2>
            <table>
              <thead>
                <tr>
                  <th>السنة</th>
                  <th>ر1</th>
                  <th>ر2</th>
                  <th>ر3</th>
                  <th>ر4</th>
                  <th>مؤشرات متحققة</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{m.year}</strong>
                  </td>
                  {(o.quarters ?? []).map((q) => (
                    <td key={q.quarter}>{q.hasPlans ? pct(q.computable ? q.progress : q.partial) : '—'}</td>
                  ))}
                  <td>
                    {snap.kpis.filter((k) => k.status === 'achieved').length}/{snap.kpis.length}
                  </td>
                </tr>
                {snap.comparison.map((c) => (
                  <tr key={c.year}>
                    <td>{c.year}</td>
                    {c.operational.map((v, i) => (
                      <td key={i}>{pct(v)}</td>
                    ))}
                    <td>
                      {c.kpiAchieved}/{c.kpiTotal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h2>{m.type === 'monthly' ? 'التحديات والملاحظات' : 'الانحرافات والتحديات'}</h2>
          {snap.deviations.length === 0 && snap.challenges.length === 0 ? (
            <p className="muted">لا انحرافات جوهرية مسجلة.</p>
          ) : (
            <ul className="facts">
              {snap.deviations.map((d, i) => (
                <li key={`d${i}`}>{d}</li>
              ))}
              {snap.challenges.map((c, i) => (
                <li key={`c${i}`}>
                  {c.title}
                  {c.department ? ` — ${c.department}` : ''} <span className="muted">({c.status === 'resolved' ? `عولج${c.resolution ? `: ${c.resolution}` : ''}` : 'قائم'})</span>
                </li>
              ))}
            </ul>
          )}
          {snap.directives.length > 0 && (
            <>
              <h3>توجيهات الفترة</h3>
              <ul className="facts">
                {snap.directives.map((d, i) => (
                  <li key={i}>
                    {d.title} <span className="muted">({{ open: 'مفتوح', in_progress: 'قيد المعالجة', closed: 'مغلق' }[d.status as 'open']})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="avoid">
          <h2>{m.type === 'quarterly' ? 'تعليق المدير التنفيذي والتوصيات' : 'تعليق المدير التنفيذي'}</h2>
          {comment ? <div className="comment">{comment}</div> : <p className="muted">لم يُضف تعليق.</p>}
        </section>

        <footer>
          <span>رواسم | منصة الأداء المؤسسي — نسخة ثابتة لا تتغير بتعديل البيانات لاحقًا</span>
          <span>إصدار أوزان الإدارات: {snap.meta.weightsVersion ?? '—'}</span>
        </footer>
      </div>
    </div>
  );
}
