import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { ReportDocument, REPORT_CSS } from '@/lib/reports/document';
import { PageHeader } from '@/components/ui';
import { ReportControls } from './controls';

export default async function ReportView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, profile } = await requireSession();
  const { data: r } = await sb.from('reports').select('*').eq('id', id).maybeSingle();
  if (!r) notFound();
  const { data: names } = await sb.from('profiles').select('id,full_name').in('id', [r.generated_by, r.approved_by].filter(Boolean));
  const nm = (x: string | null) => names?.find((n) => n.id === x)?.full_name ?? '—';
  return (
    <>
      <div className="no-print">
        <PageHeader back={{ href: '/reports', label: 'التقارير' }} title={r.title} />
        <ReportControls id={r.id} status={r.status} isEd={profile.role === 'executive_director'} comment={r.director_comment ?? ''} canDelete={r.status === 'draft' && (profile.role === 'executive_director' || r.generated_by === profile.id)} />
      </div>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div className="overflow-hidden rounded-xl border border-line shadow-sm print:border-0 print:shadow-none">
        <ReportDocument snap={r.snapshot} title={r.title} status={r.status} comment={r.director_comment} generatedByName={nm(r.generated_by)} approvedByName={nm(r.approved_by)} approvedAt={r.approved_at} />
      </div>
    </>
  );
}
