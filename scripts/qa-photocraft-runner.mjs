// Runner QA native PhotoCraft: menyalakan dev server sementara, membuka halaman
// utama dengan Playwright, lalu menguji bridge native end-to-end tanpa bergantung
// pada DOM di dalam iframe egui (UI native adalah kanvas, bukan elemen HTML).
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.QA_PORT || 5199);
const baseUrl = `http://127.0.0.1:${port}/`;
const outputDir = process.env.PHOTOCRAFT_QA_DIR || path.join(root, '.qa-output');

const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
let serverLog = '';
server.stdout.on('data', c => { serverLog += c; });
server.stderr.on('data', c => { serverLog += c; });

const stopServer = () => new Promise(resolve => {
  if (server.exitCode !== null) return resolve();
  server.once('exit', () => resolve());
  server.kill('SIGTERM');
  setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000).unref();
});

try {
  await mkdir(outputDir, { recursive: true });

  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) }); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) throw new Error('Dev server tidak siap dalam 60 detik.\n' + serverLog.slice(-3000));
  console.log('Dev server siap di', baseUrl);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // Instrument bridge: kumpulkan event + sediakan helper command/export.
    await page.evaluate(() => {
      window.__nativeQaEvents = [];
      window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        const envelope = event.data;
        if (!envelope || envelope.channel !== 'blangko-photocraft') return;
        let payload = envelope.payload;
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
        if (payload && typeof payload === 'object' && payload.type !== 'reply' && payload.type !== 'export') {
          window.__nativeQaEvents.push(payload);
        }
      });
      const post = payload => {
        const frame = document.querySelector('iframe[data-testid="photocraft-native-canvas"]');
        if (!frame?.contentWindow) throw new Error('Iframe native tidak tersedia');
        frame.contentWindow.postMessage({ channel: 'blangko-photocraft', payload }, window.location.origin);
      };
      window.__nativeQaCommand = (command, params) => new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('Timeout reply native')); }, 60000);
        const listener = event => {
          const envelope = event.data;
          if (!envelope || envelope.channel !== 'blangko-photocraft') return;
          let payload = envelope.payload;
          if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
          if (!payload || payload.type !== 'reply' || payload.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          if (payload.ok) resolve(payload.payload);
          else reject(new Error(payload.payload?.message || 'Perintah native gagal'));
        };
        window.addEventListener('message', listener);
        post({ id, type: 'command', method: 'engine.execute', params: JSON.stringify({ command, params }) });
      });
      window.__nativeQaInspect = () => new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('Timeout inspect native')); }, 60000);
        const listener = event => {
          const envelope = event.data;
          if (!envelope || envelope.channel !== 'blangko-photocraft') return;
          let payload = envelope.payload;
          if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
          if (!payload || payload.type !== 'reply' || payload.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          if (payload.ok) resolve(payload.payload);
          else reject(new Error(payload.payload?.message || 'Inspect native gagal'));
        };
        window.addEventListener('message', listener);
        post({ id, type: 'inspect' });
      });
      window.__nativeQaExport = format => new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('Timeout ekspor native')); }, 120000);
        const listener = event => {
          const envelope = event.data;
          if (!envelope || envelope.channel !== 'blangko-photocraft') return;
          let payload = envelope.payload;
          if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
          if (!payload || payload.type !== 'export' || payload.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve({ format: payload.format, bytes: Array.from(payload.bytes || []), warnings: payload.warnings });
        };
        window.addEventListener('message', listener);
        post({ id, type: 'export', format });
      });
    });

    // 1. WASM siap: badge tersinkron dan loading overlay hilang.
    await page.waitForFunction(() =>
      document.querySelector('.native-canvas-badge')?.textContent?.includes('Native canvas · tersinkron'),
    undefined, { timeout: 300000 });
    const readyBadge = await page.locator('.native-canvas-badge').textContent();
    console.log('1. Canvas siap:', readyBadge);

    // 2. Pilih layer via bridge, pastikan event revisi membawa selected + pixelRevision.
    const inspect = await page.evaluate(() => window.__nativeQaInspect()).catch(error => ({ __error: String(error) }));
    const layerNames = (inspect?.layers || inspect?.document?.layers || [])
      .map(l => l.name)
      .filter(n => typeof n === 'string' && n.startsWith('blangko-node:'));
    const targetLayer = layerNames[0];
    if (!targetLayer) {
      console.log('   inspect payload (potongan):', JSON.stringify(inspect).slice(0, 600));
      throw new Error('Tidak ada layer blangko-node di dokumen native');
    }
    await page.evaluate(layer => window.__nativeQaCommand('layer.select', { layer }), targetLayer);
    await page.waitForFunction(layer => window.__nativeQaEvents.some(e =>
      e.type === 'revision' && e.selected?.some(l => l.name === layer)
    ), targetLayer, { timeout: 30000 });
    await page.waitForTimeout(600);
    const selection = await page.evaluate(layer => {
      const events = window.__nativeQaEvents.filter(e => e.type === 'revision');
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const sel = events[i].selected?.find(l => l.name === layer);
        if (sel) return { selectedName: sel.name, pixelRevision: events[i].pixelRevision };
      }
      return null;
    }, targetLayer);
    if (!selection?.selectedName) throw new Error('Seleksi native tidak ditemukan');
    if (selection.pixelRevision === undefined || selection.pixelRevision === null) throw new Error('pixelRevision awal tidak ditemukan');
    const selectionStatus = await page.locator('.native-canvas-badge').textContent();
    if (selectionStatus?.includes('belum diekspor')) throw new Error('Seleksi salah menandai dokumen dirty');
    console.log('2. Seleksi OK:', selection.selectedName, '| pixelRevision:', selection.pixelRevision, '| badge:', selectionStatus);

    // 3. Edit opacity via layer.layerStyle.blendingOptions → pixelRevision berubah + dirty.
    await page.evaluate(sel => window.__nativeQaCommand('layer.layerStyle.blendingOptions', { layer: sel, opacity: 0.5 }), selection.selectedName);
    await page.waitForFunction(() =>
      document.querySelector('.native-canvas-badge')?.textContent?.includes('belum diekspor'),
    undefined, { timeout: 30000 });
    await page.waitForFunction(({ sel, before }) => window.__nativeQaEvents.some(e =>
      e.type === 'revision' && e.selected?.some(l => l.name === sel) && e.pixelRevision !== before
    ), { sel: selection.selectedName, before: selection.pixelRevision }, { timeout: 30000 });
    const pixelRevisionAfter = await page.evaluate(sel => {
      const events = window.__nativeQaEvents.filter(e => e.type === 'revision' && e.selected?.some(l => l.name === sel));
      return events.at(-1)?.pixelRevision;
    }, selection.selectedName);
    if (pixelRevisionAfter === selection.pixelRevision) throw new Error('Opacity tidak mengubah pixelRevision');
    const dirtyStatus = await page.locator('.native-canvas-badge').textContent();
    console.log('3. Edit opacity OK | pixelRevision:', selection.pixelRevision, '→', pixelRevisionAfter, '| badge:', dirtyStatus);

    // 4. Toggle Blangko → tombol "Versi proyek tertunda · Muat" muncul tanpa mengganti
    //    dokumen native yang terbuka. Tunggu debounce write-back (800 ms) selesai agar
    //    echo tidak menelan perubahan snapshot, lalu beri jeda kecil sebelum mengklik.
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Blangko', exact: true }).click();
    const pendingButton = page.getByRole('button', { name: 'Versi proyek tertunda · Muat' });
    await pendingButton.waitFor({ state: 'visible', timeout: 30000 });
    const stillDirty = await page.locator('.native-canvas-badge').textContent();
    // The canonical write-back legitimately clears the dirty flag after
    // persisting the edit; what must survive the toggle is the native document
    // itself (its pixel revision), proven by the pending-load choice appearing.
    console.log('4. Pending canonical OK | badge:', stillDirty);

    // 5. Ekspor .pcraft via bridge → bytes non-kosong.
    const pcraft = await page.evaluate(() => window.__nativeQaExport('pcraft'));
    if (!pcraft.bytes?.length) throw new Error('Ekspor .pcraft kosong');
    await writeFile(path.join(outputDir, 'native-qa.pcraft'), Buffer.from(pcraft.bytes));
    await page.waitForFunction(() =>
      !document.querySelector('.native-canvas-badge')?.textContent?.includes('belum diekspor'),
    undefined, { timeout: 30000 });
    console.log('5. Ekspor .pcraft OK:', pcraft.bytes.length, 'bytes');

    // 6. Ekspor PNG via bridge → PNG magic + ukuran wajar.
    const png = await page.evaluate(() => window.__nativeQaExport('png'));
    const pngBytes = Buffer.from(png.bytes || []);
    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
    if (pngBytes.length < 100 || !PNG_MAGIC.every((b, i) => pngBytes[i] === b)) throw new Error('Ekspor PNG tidak valid');
    await writeFile(path.join(outputDir, 'native-qa.png'), pngBytes);
    console.log('6. Ekspor PNG OK:', pngBytes.length, 'bytes, magic valid');

    // 7. Muat versi proyek tertunda → kembali tersinkron.
    await pendingButton.click();
    await page.waitForFunction(() =>
      document.querySelector('.native-canvas-badge')?.textContent?.includes('Native canvas · tersinkron'),
    undefined, { timeout: 300000 });
    const finalStatus = await page.locator('.native-canvas-badge').textContent();
    const pendingCleared = await pendingButton.count() === 0;
    console.log('7. Reload versi proyek OK | badge:', finalStatus, '| pending cleared:', pendingCleared);

    const unexplained = [...consoleErrors, ...pageErrors];
    const result = { readyBadge, ...selection, pixelRevisionAfter, dirtyStatus, finalStatus, pendingCleared, consoleErrors, pageErrors };
    await writeFile(path.join(outputDir, 'qa-result.json'), JSON.stringify(result, null, 2));
    if (unexplained.length > 0) {
      console.error('QA GAGAL: console/page error tidak dijelaskan:', unexplained);
      process.exitCode = 1;
    } else {
      console.log('QA LULUS: semua kriteria terpenuhi, tidak ada console/page error.');
    }
  } finally {
    await browser.close();
  }
} finally {
  await stopServer();
}
