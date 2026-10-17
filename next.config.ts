import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // مكتبات الخادم الثقيلة (توليد PDF) لا تُحزم
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core', 'exceljs'],
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },
  poweredByHeader: false,
  // خطوط PDF تُقرأ من القرص وقت التشغيل
  outputFileTracingIncludes: {
    '/api/reports/**': ['./node_modules/@fontsource/ibm-plex-sans-arabic/files/*-normal.woff2'],
    '/reports/**': ['./node_modules/@fontsource/ibm-plex-sans-arabic/files/*-normal.woff2'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
