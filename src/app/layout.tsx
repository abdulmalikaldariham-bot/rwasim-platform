import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'رواسم | منصة الأداء المؤسسي', template: '%s — رواسم' },
  description: 'إدارة الخطط التنفيذية والتشغيلية ومتابعة الإنجاز وقياس الأداء في جمعية رواسم',
  icons: { icon: '/icon.svg' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#013047' },
    { media: '(prefers-color-scheme: dark)', color: '#04141b' },
  ],
};

// يضبط الوضع قبل الرسم لتجنب الوميض
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster position="bottom-left" dir="rtl" richColors closeButton toastOptions={{ style: { fontFamily: 'IBM Plex Sans Arabic' } }} />
      </body>
    </html>
  );
}
