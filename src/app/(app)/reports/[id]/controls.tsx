'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Printer } from 'lucide-react';
import { Button, Label, Panel, Textarea } from '@/components/ui';
import { approveReportAction, deleteReportAction, saveReportCommentAction } from '@/app/actions/reports';

export function ReportControls({ id, status, isEd, comment: c0, canDelete }: { id: string; status: string; isEd: boolean; comment: string; canDelete: boolean }) {
  const [comment, setComment] = useState(c0);
  const [pending, start] = useTransition();
  const [pdfBusy, setPdfBusy] = useState(false);
  const router = useRouter();
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/reports/${id}/pdf`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? 'تعذر توليد PDF');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'تقرير.pdf';
      a.click();
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadPdf} disabled={pdfBusy}>
          <Download size={16} /> {pdfBusy ? 'جارٍ التوليد…' : 'تنزيل PDF'}
        </Button>
        <a href={`/api/reports/${id}/xlsx`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-sunken">
          <Download size={16} /> تنزيل Excel
        </a>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> طباعة
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            className="text-stalled"
            disabled={pending}
            onClick={() =>
              confirm('حذف مسودة التقرير؟') &&
              start(async () => {
                const r = await deleteReportAction(id);
                r.ok ? router.push('/reports') : toast.error(r.error);
              })
            }
          >
            حذف المسودة
          </Button>
        )}
      </div>
      {isEd && status === 'draft' && (
        <Panel className="p-5">
          <Label htmlFor="dc">تعليق المدير التنفيذي قبل الاعتماد</Label>
          <Textarea id="dc" className="min-h-28" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="القراءة العامة للأداء، والتوصيات، والقرارات المتخذة." />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
              const r = await saveReportCommentAction(id, comment);
              r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
            })}>
              حفظ التعليق
            </Button>
            <Button disabled={pending} onClick={() => confirm('بعد الاعتماد لا يمكن تعديل التقرير. متابعة؟') && start(async () => {
              const r = await approveReportAction(id, comment);
              r.ok ? (toast.success(r.message), router.refresh()) : toast.error(r.error);
            })}>
              اعتماد التقرير
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
