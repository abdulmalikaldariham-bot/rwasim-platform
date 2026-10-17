import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildExecutiveTemplate } from '@/lib/import/templates';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'سجّل الدخول' }, { status: 401 });
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear() + 1;
  const { data: depts } = await sb.from('departments').select('name').eq('is_active', true).order('sort_order');
  const buf = await buildExecutiveTemplate({ year, departments: (depts ?? []).map((d) => d.name) });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`قالب الخطة التنفيذية ${year}.xlsx`)}`,
    },
  });
}
