'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { updateStepAction } from '@/app/actions/steps';

export function QuickComplete({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await updateStepAction({ stepId: id, status: 'completed' });
          r.ok ? toast.success('اكتملت المهمة') : toast.error(r.error);
        })
      }
      className="inline-flex h-8 items-center gap-1 rounded-xl border border-line px-3 text-xs font-semibold hover:bg-sunken disabled:opacity-50"
    >
      <Check size={14} /> تم الإنجاز
    </button>
  );
}
