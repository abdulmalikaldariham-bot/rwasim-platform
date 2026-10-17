// لقطات شاشة للمراجعة البصرية أثناء التطوير: node shot.mjs <email> <out-dir> <path1> [path2...]
import puppeteer from 'puppeteer-core';
const [email, outDir, ...paths] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:3000';
const width = Number(process.env.W ?? 1440);
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(base + '/login', { waitUntil: 'networkidle0', timeout: 120000 });
await page.type('#email', email);
await page.type('#password', process.env.PW ?? 'Demo-Rawasim-2026');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 }), page.click('button[type=submit]')]);
for (const p of paths) {
  if (process.env.DARK) await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  const res = await page.goto(base + p, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));
  const name = p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
  await page.screenshot({ path: `${outDir}/${email.split('@')[0]}_${name}${process.env.DARK ? '_dark' : ''}${width < 800 ? '_m' : ''}.png`, fullPage: true });
  console.log(res.status(), p, page.url());
}
await browser.close();
