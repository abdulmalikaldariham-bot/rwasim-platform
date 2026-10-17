import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="جارٍ التحميل">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-[1.25rem]" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-[1.25rem]" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 rounded-[1.25rem]" />
        <Skeleton className="h-40 rounded-[1.25rem]" />
      </div>
    </div>
  );
}
