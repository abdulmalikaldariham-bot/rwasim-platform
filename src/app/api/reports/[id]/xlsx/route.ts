import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reportToXlsx } from '@/lib/reports/xlsx';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: r } = await sb.from('reports').select('*').eq('id', id).maybeSingle();
  if (!r) return NextResponse.json({ error: 'التقرير غير متاح' }, { status: 404 });
  const buf = await reportToXlsx(r.snapshot, r.title, r.director_comment, r.status);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.title + '.xlsx')}`,
    },
  });
}
