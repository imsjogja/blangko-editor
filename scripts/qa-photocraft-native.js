async page => {
  const outputDir = process.env.PHOTOCRAFT_QA_DIR || '/mnt/agents/.work';
  const { mkdir } = await import('node:fs/promises');
  await mkdir(outputDir, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());

  await page.addInitScript(() => {
    window.__nativeQaEvents = [];
    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin) return;
      const envelope = event.data;
      if (!envelope || envelope.channel !== 'blangko-photocraft') return;
      let payload = envelope.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (payload && typeof payload === 'object') window.__nativeQaEvents.push(payload);
    });
    window.__nativeQaCommand = (command, params) => new Promise((resolve, reject) => {
      const frame = document.querySelector('iframe[data-testid="photocraft-native-canvas"]');
      if (!frame?.contentWindow) return reject(new Error('Iframe native tidak tersedia'));
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        reject(new Error('Timeout menunggu reply native'));
      }, 60000);
      const listener = event => {
        const envelope = event.data;
        if (!envelope || envelope.channel !== 'blangko-photocraft') return;
        let payload = envelope.payload;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch { return; }
        }
        if (!payload || payload.type !== 'reply' || payload.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        if (payload.ok) resolve(payload.payload);
        else reject(new Error(payload.payload?.message || 'Perintah native gagal'));
      };
      window.addEventListener('message', listener);
      frame.contentWindow.postMessage({
        channel: 'blangko-photocraft',
        payload: {
          id,
          type: 'command',
          method: 'engine.execute',
          params: JSON.stringify({ command, params }),
        },
      }, window.location.origin);
    });
  });

  await page.reload();
  const frame = page.frameLocator('iframe[data-testid="photocraft-native-canvas"]');
  const exportButton = frame.getByRole('button', { name: '.pcraft', exact: true });
  await exportButton.waitFor({ state: 'visible', timeout: 180000 });
  await frame.locator('body').waitFor({ state: 'attached', timeout: 180000 });
  await page.waitForFunction(() => {
    const frameEl = document.querySelector('iframe[data-testid="photocraft-native-canvas"]');
    const doc = frameEl?.contentDocument;
    if (!doc) return false;
    const button = [...doc.querySelectorAll('button')].find(item => item.textContent?.trim() === '.pcraft');
    return button && !button.disabled;
  }, undefined, { timeout: 180000 });

  await frame.getByRole('tab', { name: /Layer/ }).click();
  const firstLayer = frame.locator('.layer-select').first();
  await firstLayer.waitFor({ state: 'visible' });
  const layerLabel = (await firstLayer.textContent())?.trim();
  await firstLayer.click();
  await page.waitForFunction(() => window.__nativeQaEvents.some(event =>
    event.type === 'revision' && event.selected?.some(layer => layer.name.startsWith('blangko-node:'))
  ), undefined, { timeout: 30000 });
  await page.waitForTimeout(600);

  const selection = await page.evaluate(() => {
    const events = window.__nativeQaEvents.filter(event => event.type === 'revision');
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const selected = events[index].selected?.find(layer => layer.name.startsWith('blangko-node:'));
      if (selected) return { selectedName: selected.name, pixelRevision: events[index].pixelRevision };
    }
    return null;
  });
  if (!selection?.selectedName) throw new Error('Seleksi native tidak ditemukan');
  const { selectedName, pixelRevision: pixelRevisionBefore } = selection;
  if (pixelRevisionBefore === undefined || pixelRevisionBefore === null) {
    throw new Error('pixelRevision awal tidak ditemukan');
  }
  const selectionStatus = await page.locator('.native-canvas-badge').textContent();
  if (selectionStatus?.includes('belum diekspor')) throw new Error('Seleksi salah menandai dokumen dirty');

  await page.evaluate(async selected => {
    await window.__nativeQaCommand('layer.layerStyle.blendingOptions', {
      layer: selected,
      opacity: 0.5,
    });
  }, selectedName);
  await page.waitForFunction(() => document.querySelector('.native-canvas-badge')?.textContent?.includes('belum diekspor'), undefined, { timeout: 30000 });
  await page.waitForFunction(({ selected, before }) => window.__nativeQaEvents.some(event =>
    event.type === 'revision' &&
    event.selected?.some(layer => layer.name === selected) &&
    event.pixelRevision !== before
  ), { selected: selectedName, before: pixelRevisionBefore }, { timeout: 30000 });
  const pixelRevisionAfter = await page.evaluate(selected => {
    const events = window.__nativeQaEvents.filter(event =>
      event.type === 'revision' && event.selected?.some(layer => layer.name === selected)
    );
    return events.at(-1)?.pixelRevision;
  }, selectedName);
  if (pixelRevisionAfter === pixelRevisionBefore) throw new Error('Opacity tidak mengubah pixelRevision');
  const dirtyStatus = await page.locator('.native-canvas-badge').textContent();

  await page.getByRole('button', { name: 'Blangko', exact: true }).click();
  const pendingButton = page.getByRole('button', { name: 'Versi proyek tertunda · Muat' });
  await pendingButton.waitFor({ state: 'visible', timeout: 30000 });

  const pcraftDownload = page.waitForEvent('download', { timeout: 120000 });
  await exportButton.click();
  const pcraft = await pcraftDownload;
  await pcraft.saveAs(`${outputDir}/native-qa.pcraft`);
  await page.waitForFunction(() => !document.querySelector('.native-canvas-badge')?.textContent?.includes('belum diekspor'), undefined, { timeout: 30000 });

  const pngDownload = page.waitForEvent('download', { timeout: 120000 });
  await frame.getByRole('button', { name: 'PNG', exact: true }).click();
  const png = await pngDownload;
  await png.saveAs(`${outputDir}/native-qa.png`);

  await pendingButton.click();
  await page.waitForFunction(() => {
    const frameEl = document.querySelector('iframe[data-testid="photocraft-native-canvas"]');
    const doc = frameEl?.contentDocument;
    if (!doc) return false;
    const button = [...doc.querySelectorAll('button')].find(item => item.textContent?.trim() === '.pcraft');
    return button && !button.disabled;
  }, undefined, { timeout: 180000 });
  await page.waitForFunction(() =>
    document.querySelector('.native-canvas-badge')?.textContent?.includes('Native canvas · tersinkron'),
  undefined, { timeout: 180000 });

  return {
    layerLabel,
    selectedName,
    selectionStatus,
    dirtyStatus,
    pixelRevisionBefore,
    pixelRevisionAfter,
    pcraftName: pcraft.suggestedFilename(),
    pngName: png.suggestedFilename(),
    pendingCleared: await pendingButton.count() === 0,
    finalStatus: await page.locator('.native-canvas-badge').textContent(),
    consoleErrors,
    pageErrors,
  };
}
