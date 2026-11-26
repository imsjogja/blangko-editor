// Smoke test production: browser segar melawan `npm start` yang sudah berjalan.
import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_URL || 'http://127.0.0.1:5299/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document.querySelector('.native-canvas-badge')?.textContent?.includes('Native canvas · tersinkron'),
  undefined, { timeout: 300000 });
  const badge = await page.locator('.native-canvas-badge').textContent();
  const wasmOk = await page.evaluate(async () => {
    const res = await fetch(document.querySelector('iframe[data-testid="photocraft-native-canvas"]')?.src || '');
    return res.ok;
  });
  console.log(JSON.stringify({ badge, wasmFrameOk: wasmOk, consoleErrors, pageErrors }, null, 2));
  if (consoleErrors.length || pageErrors.length) {
    console.error('SMOKE GAGAL');
    process.exitCode = 1;
  } else {
    console.log('SMOKE LULUS: fresh browser, canvas tersinkron, nol console/page error.');
  }
} finally {
  await browser.close();
}
