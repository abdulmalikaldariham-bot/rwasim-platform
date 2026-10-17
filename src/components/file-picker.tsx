'use client';
import { useId, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';

/** اختيار ملف بنص عربي (بدل نص المتصفح الافتراضي) */
export function FilePicker({ accept = '.xlsx', label = 'اختر ملف Excel', onFile, busy }: { accept?: string; label?: string; onFile: (f: File) => void; busy?: boolean }) {
  const id = useId();
  const [name, setName] = useState<string | null>(null);
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-4 py-3 text-sm hover:border-teal hover:bg-sunken">
      <FileSpreadsheet size={18} className={busy ? 'animate-pulse text-teal' : 'text-teal'} />
      <span className="font-medium text-teal">{label}</span>
      <span className="truncate text-muted">{busy ? 'جارٍ القراءة…' : name ?? 'لم يُختر ملف'}</span>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setName(f.name);
            onFile(f);
          }
          e.target.value = '';
        }}
      />
    </label>
  );
}
