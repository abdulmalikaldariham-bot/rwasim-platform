// شارة رواسم: طبقات رسوبية متراكبة (تصميم أصلي مؤقت حتى اعتماد شعار الجمعية)
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="3" y="5" width="26" height="5" rx="2.5" fill="#f09223" />
      <rect x="6" y="13.5" width="23" height="5" rx="2.5" fill="#6fb3c2" />
      <rect x="3" y="22" width="20" height="5" rx="2.5" fill="#cfe0e4" />
    </svg>
  );
}
export function Wordmark({ light = true }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="leading-tight">
        <span className={light ? 'block text-lg font-bold text-white' : 'block text-lg font-bold text-ink'}>رواسم</span>
        <span className={light ? 'block text-xs text-nav-text' : 'block text-xs text-muted'}>منصة الأداء المؤسسي</span>
      </span>
    </span>
  );
}
