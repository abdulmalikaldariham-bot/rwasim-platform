import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { todayISO, quarterCurve, type CurvePoint } from '../engine/progress';
import type { OrgEval } from '../engine/types';
import type { YearProgress } from './progress';

export interface Department {
  id: string;
  name: string;
  short_name: string | null;
  code: string;
  sort_order: number;
  is_active: boolean;
}

export async function getDepartments(sb: SupabaseClient, includeInactive = false): Promise<Department[]> {
  let q = sb.from('departments').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data ?? []) as Department[];
}

export async function getYears(sb: SupabaseClient): Promise<{ year: number; status: string; is_transitional: boolean }[]> {
  const { data } = await sb.from('years').select('year,status,is_transitional').order('year', { ascending: false });
  return data ?? [];
}

export interface Period {
  year: number;
  quarter: number;
  years: { year: number; status: string; is_transitional: boolean }[];
  today: string;
}

export async function resolvePeriod(sb: SupabaseClient, sp: { year?: string; q?: string }): Promise<Period> {
  const years = await getYears(sb);
  const today = todayISO();
  const curYear = Number(today.slice(0, 4));
  const curQ = Math.ceil(Number(today.slice(5, 7)) / 3);
  let year = Number(sp.year) || (years.some((y) => y.year === curYear) ? curYear : years[0]?.year ?? curYear);
  if (!years.some((y) => y.year === year) && years.length) year = years[0].year;
  let quarter = Number(sp.q) || (year === curYear ? curQ : 4);
  if (quarter < 1 || quarter > 4) quarter = curQ;
  return { year, quarter, years, today };
}

export function deptName(depts: Department[], id: string | null | undefined, short = false) {
  const d = depts.find((x) => x.id === id);
  return d ? (short ? d.short_name ?? d.name : d.name) : '—';
}

/** منحنى الجمعية = منحنيات الإدارات موزونة بأوزانها (للإدارات المعتمدة فقط) */
export function orgCurve(yp: YearProgress, quarter: number, org: OrgEval, asOf = todayISO()): CurvePoint[] {
  const b = yp.boundaries[quarter] ?? [];
  const plans = yp.plans.filter((p) => p.quarter === quarter && (p.status === 'approved' || p.status === 'archived'));
  const included = yp.weights.filter((w) => w.weight > 0 && plans.some((p) => p.departmentId === w.departmentId));
  const total = included.reduce((s, w) => s + w.weight, 0);
  if (!total) return [];
  const curves = included.map((w) => ({ w: w.weight, c: quarterCurve(plans.find((p) => p.departmentId === w.departmentId)!, b, asOf) }));
  void org;
  return b.map((wk, i) => {
    const planned = curves.reduce((s, x) => s + x.w * x.c[i].planned, 0) / total;
    const actualVals = curves.map((x) => x.c[i].actual);
    const actual = actualVals.some((v) => v === null) ? null : curves.reduce((s, x) => s + x.w * (x.c[i].actual ?? 0), 0) / total;
    return { weekIndex: wk.weekIndex, label: curves[0].c[i].label, planned: Math.round(planned * 10) / 10, actual: actual === null ? null : Math.round(actual * 10) / 10 };
  });
}

export async function getSetting<T>(sb: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
