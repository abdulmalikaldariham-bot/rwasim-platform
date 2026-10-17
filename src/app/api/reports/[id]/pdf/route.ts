import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderReportHtml, htmlToPdf } from '@/lib/reports/pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: r } = await sb.from('reports').select('*').eq('id', id).maybeSingle();
  if (!r) return NextResponse.json({ error: 'التقرير غير متاح' }, { status: 404 });
  const filename = encodeURIComponent(`${r.title}.pdf`);
  if (r.status === 'approved') {
    const stored = await sb.storage.from('reports').download(`${id}/approved.pdf`);
    if (stored.data) return new NextResponse(stored.data, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${filename}` } });
  }
  const { data: names } = await sb.from('profiles').select('id,full_name').in('id', [r.generated_by, r.approved_by].filter(Boolean));
  const nm = (x: string | null) => names?.find((n) => n.id === x)?.full_name ?? '—';
  const html = await renderReportHtml({ snap: r.snapshot, title: r.title, status: r.status, comment: r.director_comment, generatedByName: nm(r.generated_by), approvedByName: nm(r.approved_by), approvedAt: r.approved_at });
  if (req.nextUrl.searchParams.get('html') === '1') return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  try {
    const pdf = await htmlToPdf(html, r.title);
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${filename}` } });
  } catch (e) {
    return NextResponse.json({ error: 'تعذر توليد PDF على الخادم: ' + (e as Error).message + ' — استخدم «طباعة» من صفحة التقرير.' }, { status: 500 });
  }
}
