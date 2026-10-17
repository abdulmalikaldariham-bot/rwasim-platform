// أرقام لاتينية للوضوح مع نص عربي (اختيار متسق في كل المنصة)
const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
const df = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' });
const dfy = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' });
const dtf = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '—' : nf.format(n));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${nf.format(n)}٪`);
export const fmtDate = (d: string | null | undefined) => (d ? df.format(new Date(d.length === 10 ? d + 'T12:00:00Z' : d)) : '—');
export const fmtDateY = (d: string | null | undefined) => (d ? dfy.format(new Date(d.length === 10 ? d + 'T12:00:00Z' : d)) : '—');
export const fmtDateTime = (d: string | null | undefined) => (d ? dtf.format(new Date(d)) : '—');

export function relDays(d: string | null | undefined): string {
  if (!d) return 'لم يحدّث';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days === 2) return 'قبل يومين';
  if (days <= 10) return `قبل ${days} أيام`;
  return `قبل ${days} يومًا`;
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}
