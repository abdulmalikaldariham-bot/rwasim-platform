'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { assignStepAction, evidenceUrlAction } from '@/app/actions/steps';

export function AssignSelect({ stepId, value, people }: { stepId: string; value: string | null; people: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="تفويض المهمة"
      disabled={pending}
      defaultValue={value ?? ''}
      className="h-8 max-w-44 rounded-md border border-line bg-surface px-2 text-xs"
      onChange={(e) =>
        start(async () => {
          const r = await assignStepAction(stepId, e.target.value || null);
          r.ok ? toast.success(r.message) : toast.error(r.error);
        })
      }
    >
      <option value="">غير مفوضة</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function EvidenceLink({ path, name }: { path: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex items-center gap-1 text-sm text-teal hover:underline"
      onClick={() =>
        start(async () => {
          const r = await evidenceUrlAction(path);
          if (r.url) window.open(r.url, '_blank', 'noopener');
          else toast.error(r.error ?? 'تعذر فتح الملف');
        })
      }
    >
      <FileText size={14} /> {name}
    </button>
  );
}
