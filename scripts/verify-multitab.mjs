/* Verifikasi Fase 2: bridge multi-tab PhotoCraft (protokol 3) */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:7101/';
const result = { steps: [], ok: true };
const step = (name, data) => { result.steps.push({ name, ...data }); console.log(`[STEP] ${name}:`, JSON.stringify(data)); };

async function installBridgeTap(page) {
  await page.evaluate(() => {
    if (window.__bridgeTap) return;
    window.__bridgeLog = [];
    window.__bridgeTap = true;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.channel !== 'blangko-photocraft' || !d.payload) return;
      let p = d.payload;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { /* abaikan */ } }
      if (p && typeof p === 'object' && typeof p.payload === 'string') {
        try { p = { ...p, payload: JSON.parse(p.payload) }; } catch { /* abaikan */ }
      }
      window.__bridgeLog.push(p);
      if (window.__bridgeLog.length > 600) window.__bridgeLog.shift();
    });
  });
}

const logLen = (page) => page.evaluate(() => (window.__bridgeLog ?? []).length);
const replies = (page, predicateSrc) => page.evaluate((src) => {
  const pred = eval(src);
  return (window.__bridgeLog ?? []).filter(m => m && m.type === 'reply' && pred(m));
}, predicateSrc);
const revisions = (page) => page.evaluate(() => (window.__bridgeLog ?? []).filter(m => m && m.type === 'revision'));

async function rpc(page, payload, timeoutMs = 30000) {
  return page.evaluate(({ payload, timeoutMs }) => new Promise((resolve, reject) => {
    const iframe = document.querySelector('iframe');
    if (!iframe) return reject(new Error('no iframe'));
    const id = payload.id;
    const t0 = Date.now();
    const poll = () => {
      const hit = (window.__bridgeLog ?? []).find((m) => m && m.type === 'reply' && m.id === id);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('rpc timeout ' + payload.type));
      setTimeout(poll, 100);
    };
    poll();
    iframe.contentWindow.postMessage({ channel: 'blangko-photocraft', payload }, location.origin);
  }), { payload, timeoutMs });
}

const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

async function inspect(page, doc) {
  const r = await rpc(page, { id: uuid(), type: 'inspect', ...(doc != null ? { document: doc } : {}) });
  if (!r.ok) throw new Error('inspect gagal: ' + JSON.stringify(r.payload));
  return r.payload;
}

const execCommand = (page, command, params) =>
  rpc(page, { id: uuid(), type: 'command', method: 'engine.execute', params: JSON.stringify({ command, params }) });

function findNode(root, frag) {
  let found = null;
  const visit = (v) => {
    if (!v || typeof v !== 'object' || found) return;
    if (typeof v.name === 'string' && v.name.includes(frag)) { found = v; return; }
    for (const k of Object.keys(v)) { if (found) return; const c = v[k]; if (c && typeof c === 'object') visit(c); }
  };
  visit(root);
  return found;
}

// bounds berbentuk array [x, y, w, h]
const xOf = (node) => (Array.isArray(node?.bounds) ? node.bounds[0] : node?.bounds?.x ?? null);

async function waitSynced(page, timeoutMs = 90000) {
  await page.waitForFunction(() => document.body.innerText.includes('tersinkron'), null, { timeout: timeoutMs });
}

async function clickSideTab(page, label) {
  await page.evaluate((label) => {
    const tabs = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label));
    if (!tabs.length) throw new Error('tab tidak ada: ' + label);
    tabs[0].click();
  }, label);
}

async function waitRevisionForDoc(page, docId, notEqual, timeoutMs = 60000) {
  await page.waitForFunction(({ docId, notEqual }) => {
    const revs = (window.__bridgeLog ?? []).filter(m => m && m.type === 'revision' && typeof m.document === 'number');
    if (!revs.length) return false;
    const last = revs[revs.length - 1].document;
    return notEqual ? last !== docId : last === docId;
  }, { docId, notEqual }, { timeout: timeoutMs });
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message.slice(0, 200)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await installBridgeTap(page);
  await waitSynced(page);
  step('initial-sync', { ok: true });

  const inspA0 = await inspect(page);
  const x0 = xOf(findNode(inspA0, 'outside-date'));
  const revs0 = await revisions(page);
  const docA = revs0.length ? revs0[revs0.length - 1].document : null;
  step('inspect-A-initial', { x0, docA });
  if (x0 == null || docA == null) { result.ok = false; throw new Error('layer/docId tidak ditemukan'); }

  const openCount = () => replies(page, '(m)=>m.ok && m.payload && typeof m.payload==="object" && typeof m.payload.document==="number" && "warnings" in m.payload');
  const activateCount = () => replies(page, '(m)=>m.ok && m.payload && typeof m.payload==="object" && typeof m.payload.document==="number" && !("warnings" in m.payload)');
  const openBefore = (await openCount()).length;
  const activateBefore = (await activateCount()).length;

  // Edit native: geser +24 px
  await execCommand(page, 'layer.select', { name: 'blangko-node:outside-date' });
  await execCommand(page, 'layer.translate', { dx: 24, dy: 0 });
  await page.waitForTimeout(1000);

  const inspA1 = await inspect(page, docA);
  const x1 = xOf(findNode(inspA1, 'outside-date'));
  step('edit-A-applied', { x0, x1, dx: x1 != null && x0 != null ? x1 - x0 : null });

  // Pindah ke sisi B
  await clickSideTab(page, 'Dalam');
  await waitSynced(page);
  await waitRevisionForDoc(page, docA, true).catch(() => step('warn', { msg: 'tidak ada revision dokumen lain' }));
  const revsB = await revisions(page);
  const docB = revsB.length ? revsB[revsB.length - 1].document : null;
  step('side-B-synced', { docB, distinctFromA: docB !== docA });

  // Kembali ke sisi A: dengan protokol 3 -> activate instan (tanpa reply open baru)
  const openMid = (await openCount()).length;
  const activateMid = (await activateCount()).length;
  const t0 = Date.now();
  await clickSideTab(page, 'Luar');
  await waitSynced(page);
  await waitRevisionForDoc(page, docA, false).catch(() => {});
  const switchBackMs = Date.now() - t0;
  const openAfter = (await openCount()).length;
  const activateAfter = (await activateCount()).length;

  const inspA2 = await inspect(page, docA);
  const x2 = xOf(findNode(inspA2, 'outside-date'));
  const persisted = x1 != null && x2 != null && Math.abs(x2 - x1) < 2;
  const noReopen = openAfter === openMid;
  const activated = activateAfter > activateMid;
  step('back-to-A', { switchBackMs, persisted, x2, noReopen, activated, counts: { open: [openBefore, openMid, openAfter], activate: [activateBefore, activateMid, activateAfter] } });

  result.ok = result.ok && persisted && (x1 - x0) >= 23 && docB !== docA && noReopen;
  result.verdict = result.ok ? 'PASS' : 'FAIL';
  await browser.close();
  console.log('RESULT:' + JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

run().catch((e) => { console.error('FATAL', e); console.log('RESULT:' + JSON.stringify({ ...result, verdict: 'ERROR', error: String(e).slice(0, 500) }, null, 2)); process.exit(2); });
