export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-sunken" />
      <div className="h-40 animate-pulse rounded-xl bg-sunken" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-xl bg-sunken" />
        <div className="h-32 animate-pulse rounded-xl bg-sunken" />
      </div>
    </div>
  );
}
