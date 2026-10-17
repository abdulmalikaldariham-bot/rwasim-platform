/* eslint-disable @next/next/no-img-element */
// شعار جمعية رواسم: نسخة ملونة للخلفيات الفاتحة، ونسخة بيضاء للخلفيات الداكنة

/** الشعار الكامل. light = على خلفية داكنة (نسخة بيضاء). onSurface = يتبدل تلقائيًا مع الوضع الليلي */
export function Logo({ light = false, onSurface = false, className = '' }: { light?: boolean; onSurface?: boolean; className?: string }) {
  if (onSurface) {
    return (
      <>
        <img src="/brand/logo.png" alt="جمعية رواسم" className={`${className} dark:hidden`} />
        <img src="/brand/logo-white.png" alt="جمعية رواسم" className={`${className} hidden dark:block`} />
      </>
    );
  }
  return <img src={light ? '/brand/logo-white.png' : '/brand/logo.png'} alt="جمعية رواسم" className={className} />;
}

/** الشعار مع اسم المنصة. compact للشريط العلوي في الجوال */
export function Wordmark({ light = true, compact = false }: { light?: boolean; compact?: boolean }) {
  const sub = light ? 'text-nav-text' : 'text-muted';
  if (compact) {
    return (
      <span className="flex items-center gap-3">
        <Logo light={light} className="h-11 w-auto" />
        <span className={`text-xs ${sub}`}>منصة الأداء المؤسسي</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center gap-3 text-center">
      <Logo light={light} className="w-40 max-w-full" />
      <span className={`text-sm font-medium ${sub}`}>منصة الأداء المؤسسي</span>
    </span>
  );
}

/** للتوافق مع أي استخدام قديم */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <img src="/brand/icon.png" alt="" width={size} height={size} className="rounded" />;
}
