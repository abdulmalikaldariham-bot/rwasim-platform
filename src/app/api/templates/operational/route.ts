import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildOperationalTemplate } from '@/lib/import/templates';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'سجّل الدخول' }, { status: 401 });
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear();
  const quarter = Math.min(4, Math.max(1, Number(req.nextUrl.searchParams.get('q')) || 1));
  const { data: me } = await sb.from('profiles').select('role,department_id').eq('id', u.user.id).single();
  let q = sb.from('departments').select('id,name').eq('is_active', true).order('sort_order');
  if (me?.role === 'dept_manager' && me.department_id) q = q.eq('id', me.department_id);
  const { data: depts } = await q;
  const buf = await buildOperationalTemplate({ year, quarter, departments: (depts ?? []).map((d) => d.name) });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`قالب الخطة التشغيلية ر${quarter} ${year}.xlsx`)}`,
    },
  });
}
