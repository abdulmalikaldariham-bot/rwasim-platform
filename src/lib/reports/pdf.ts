import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReportSnapshot } from './build';

function fontFace(weight: number) {
  const dir = path.join(process.cwd(), 'node_modules/@fontsource/ibm-plex-sans-arabic/files');
  const faces = ['arabic', 'latin'].map((subset) => {
    const b64 = readFileSync(path.join(dir, `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`)).toString('base64');
    return `@font-face{font-family:'IBM Plex Sans Arabic';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  });
  return faces.join('\n');
}

export async function renderReportHtml(props: {
  snap: ReportSnapshot;
  title: string;
  status: 'draft' | 'approved';
  comment: string | null;
  generatedByName: string;
  approvedByName?: string | null;
  approvedAt?: string | null;
}): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { ReportDocument, REPORT_CSS } = await import('./document');
  const body = renderToStaticMarkup(createElement(ReportDocument, props));
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${props.title.replace(/[<>&]/g, '')}</title>
<style>${[400, 600, 700].map(fontFace).join('\n')}
@page{size:A4;margin:14mm 12mm}
body{margin:0}
${REPORT_CSS}</style></head><body>${body}</body></html>`;
}

async function launch() {
  const puppeteer = (await import('puppeteer-core')).default;
  const local = process.env.CHROMIUM_PATH;
  if (local) return puppeteer.launch({ executablePath: local, args: ['--no-sandbox', '--font-render-hinting=none'] });
  const chromium = (await import('@sparticuz/chromium')).default;
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

export async function htmlToPdf(html: string, footerLabel: string): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#5b7380;padding:0 12mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>${footerLabel}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
