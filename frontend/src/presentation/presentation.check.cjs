// With wails dev running: node frontend/src/presentation/presentation.check.cjs
// Synthetic video only. Build fixtures first with scripts/build-recording.ps1 -Check.
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const artifacts = path.resolve(__dirname, '../../../.tools/ui-check');
const native = path.resolve(artifacts, '../recording-build/recording-check.exe');
const source = path.resolve(artifacts, '../recording-build/tone.mp4');
const destination = path.join(artifacts, 'narrated-replay-check.mp4');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let encoder, done, page;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message); });
    await page.exposeFunction('checkBeginExport', () => {
      encoder = spawn(native, ['encode-presentation', destination, source]);
      let stderr = ''; encoder.stderr.on('data', (data) => { stderr += data; });
      done = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', (code) => code === 0 ? resolve() : reject(Error('encoder: ' + stderr))); }); done.catch(() => {});
      return 'export';
    });
    await page.exposeFunction('checkAppend', (frame) => new Promise((resolve, reject) => {
      const data = Buffer.from(frame, 'base64'), length = Buffer.alloc(4); length.writeUInt32LE(data.length);
      encoder.stdin.write(Buffer.concat([length, data]), (error) => error ? reject(error) : resolve());
    }));
    await page.exposeFunction('checkFinish', async () => { encoder.stdin.end(); await done; return destination; });
    await page.exposeFunction('checkAbort', async () => { encoder.stdin.end(); await done; });
    await page.route('**/presentation-media/check', (route) => {
      const data = fs.readFileSync(source), range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (!range) return route.fulfill({ contentType: 'video/mp4', body: data });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes' }, body: data.subarray(start, end + 1) });
    });
    await page.route('**/src/App.jsx*', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('excalidrawAPI: setApi', 'excalidrawAPI: (value) => { window.check.api = value; setApi(value); }');
      assert.ok(body.includes('window.check.api = value')); await route.fulfill({ response, body });
    });
    await page.addInitScript(() => {
      window.check = { saves: 0, frames: 0, exports: 0, releases: 0, listeners: new Map() };
      const timeline = { version: 1, srtPath: 'D:\\check\\Synthetic.srt', videoPath: 'Synthetic.mp4', baseIds: [], cues: [{ id: 1, startMs: 500, endMs: 1500, text: 'First node' }, { id: 2, startMs: 1500, endMs: 2500, text: 'Second node' }], steps: [{ cueId: 1, atMs: 500, elementIds: ['red'] }, { cueId: 2, atMs: 1500, elementIds: ['blue'] }] };
      const elements = [{ id: 'red', type: 'rectangle', x: 0, y: 0, width: 360, height: 220, backgroundColor: '#ff0000', strokeColor: '#ff0000', fillStyle: 'solid', roughness: 0, customData: { exbasePresentation: timeline } }, { id: 'blue', type: 'rectangle', x: 420, y: 0, width: 360, height: 220, backgroundColor: '#0000ff', strokeColor: '#0000ff', fillStyle: 'solid', roughness: 0 }];
      const doc = { path: 'D:\\check\\Synthetic.excalidraw', data: JSON.stringify({ type: 'excalidraw', version: 2, elements, files: {}, appState: { viewBackgroundColor: '#ffffff' } }) };
      window.go = { main: { App: {
        Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }), ReadDirectory: async () => [{ path: doc.path, name: 'Synthetic.excalidraw', isDir: false }], OpenDocument: async () => doc,
        LoadGeneralSettings: async () => ({ slidesEnabled: false, recordingEnabled: false }), LoadPromptTemplates: async () => [{ name: "SRT · Narrated replay", body: "SRT file: {{SRT file path}}\nVisual description: {{Optional visual description}}" }], LoadAISettings: async () => ({ hasAPIKey: true }),
        Save: async (path, data) => { window.check.saves++; window.check.savedScene = JSON.parse(data); }, ReleasePresentationVideo: async () => { window.check.releases++; },
        ChoosePresentationAssets: async (document, kind) => ({ ...(kind !== 'video' && { srtPath: 'Synthetic.srt' }), ...(kind !== 'srt' && { video: { token: 'check', name: 'Synthetic.mp4', path: 'Synthetic.mp4', url: '/presentation-media/check' } }) }),
        OpenPresentationAssets: async (document, paths) => {
          window.check.opens = (window.check.opens || 0) + 1;
          if (window.check.missingVideo) throw Error('file not found');
          return { ...(paths.some(p => p.endsWith('.srt')) && { srtPath: 'Synthetic.srt' }), ...(paths.some(p => p.endsWith('.mp4')) && { video: { token: 'check', name: 'Synthetic.mp4', path: 'Synthetic.mp4', url: '/presentation-media/check' } }) };
        },
        CreateAISession: async () => 'check-session', CancelAI: async () => { window.check.rejectGeneration?.(Error('Generation cancelled.')); },
        AskAI: async (document, scene, checkpoint, prompt) => {
          window.check.generationPrompt = prompt;
          if (window.check.deferGeneration) await new Promise((resolve, reject) => { window.check.rejectGeneration = reject; });
          return { reply: 'Ready', checkpointId: 'check-checkpoint', elements: JSON.parse(scene).elements.length ? JSON.parse(scene).elements.map(e => ({ ...e, customData: { ...e.customData, ...(e.id === 'red' && { exbasePresentation: { ...timeline, srtPath: 'Synthetic.srt' } }) } })) : elements };
        },
        BeginPresentationExport: async () => { window.check.exports++; window.check.frames = 0; return window.checkBeginExport(); }, AppendRecordingFrame: async (id, frame) => { await window.checkAppend(frame); window.check.frames++; }, FinishRecording: async () => window.checkFinish(), AbortRecording: async () => window.checkAbort(),
      } } };
      window.runtime = { EventsOnMultiple: (name, fn) => { window.check.listeners.set(name, fn); return () => window.check.listeners.delete(name); }, OnFileDrop: (fn) => { window.check.drop = fn; }, OnFileDropOff: () => { window.check.drop = null; }, WindowMinimise: () => {}, WindowToggleMaximise: () => {} };
    });
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    await page.getByRole('button', { name: 'Synthetic.excalidraw' }).click();
    await page.waitForFunction(() => !!window.check.api);
    const composer = page.getByRole('textbox', { name: 'Message DeepSeek' });
    await composer.fill('/SRT'); await page.getByRole('option', { name: 'SRT · Narrated replay' }).click();
    assert.ok((await composer.inputValue()).includes('SRT file: {{SRT file path}}'));
    await composer.fill('');
    const original = await page.evaluate(() => JSON.stringify(window.check.api.getSceneElements().map(e => ({ id: e.id, x: e.x, y: e.y }))));
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    await page.waitForFunction(() => document.querySelector('.replay-bubble video').readyState >= 2);
    const expectedFrames = await page.evaluate(() => Math.ceil(document.querySelector('.replay-bubble video').duration * 20));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.replay-bubble video').currentTime > 0.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const pausedAt = await page.evaluate(() => document.querySelector('.replay-bubble video').currentTime);
    await page.waitForTimeout(150); assert.equal(await page.evaluate(() => document.querySelector('.replay-bubble video').currentTime), pausedAt);
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.waitForTimeout(150);
    const pixels = () => page.evaluate(() => {
      const c = document.querySelector('.replay-stage canvas'), data = c.getContext('2d').getImageData(0, 0, 1920, 1080).data;
      let red = 0, blue = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++; if (data[i + 2] > 200 && data[i] < 60 && data[i + 1] < 60) blue++; }
      return { red, blue };
    });
    assert.deepEqual(await pixels(), { red: 0, blue: 0 });
    await page.evaluate(() => { document.querySelector('.replay-bubble video').currentTime = 1; });
    await page.waitForFunction(() => document.querySelector('.replay-caption').textContent === 'First node');
    await page.waitForTimeout(200); let color = await pixels(); assert.ok(color.red > 10000 && color.blue === 0, JSON.stringify(color));
    await page.evaluate(() => { document.querySelector('.replay-bubble video').currentTime = 2; });
    await page.waitForFunction(() => document.querySelector('.replay-caption').textContent === 'Second node');
    await page.waitForTimeout(200); color = await pixels(); assert.ok(color.red > 10000 && color.blue > 10000);
    await page.evaluate(() => { document.querySelector('.replay-bubble video').currentTime = 0; });
    await page.waitForFunction(() => document.querySelector('.replay-caption').textContent.trim() === '');
    await page.waitForTimeout(200); assert.deepEqual(await pixels(), { red: 0, blue: 0 });
    const face = page.getByRole('group', { name: /Face bubble/ }), box = await face.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 60, box.y + 140, { steps: 5 }); await page.mouse.up();
    const moved = await face.boundingBox(); assert.ok(moved.x < box.x && moved.y > box.y); assert.ok(Math.abs(moved.width - moved.height) < 1);
    const grip = page.getByRole('button', { name: 'Drag to resize face bubble' });
    await face.hover();
    const handle = await grip.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(handle.x + 24, handle.y + 24, { steps: 5 }); await page.mouse.up();
    assert.ok((await face.boundingBox()).width > moved.width);
    await page.getByRole('button', { name: 'Switch to circle' }).click();
    await page.getByRole('button', { name: 'Switch to rounded square' }).click();
    await page.getByRole('button', { name: 'Switch to circle' }).click();
    assert.equal(await page.getByRole('combobox').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Change video', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Change SRT', exact: true }).count(), 0);
    const stageBounds = await page.locator('.replay-stage').boundingBox(), controlsBounds = await page.locator('.replay-controls').boundingBox();
    assert.ok(controlsBounds.x > stageBounds.x + stageBounds.width);
    const size = page.getByRole('slider', { name: 'Face bubble size' }); await size.focus(); await size.press('Home');
    for (let i = 0; i < 16; i++) await size.press('ArrowRight');
    await page.evaluate(() => { document.querySelector('.replay-bubble video').currentTime = 2; });
    await page.waitForFunction(() => document.querySelector('.replay-caption').textContent === 'Second node');
    await page.screenshot({ path: path.join(artifacts, 'narrated-replay-preview.png') });
    await page.getByRole('button', { name: 'Export MP4' }).click();
    await page.waitForFunction(() => window.check.frames > 0);
    assert.ok(await page.getByRole('button', { name: 'Close narrated replay' }).isDisabled());
    await page.getByRole('button', { name: 'Cancel export' }).click();
    await page.getByRole('button', { name: 'Export MP4' }).waitFor();
    assert.ok((await page.locator('.replay-status').innerText()).includes('Export cancelled'));
    await page.getByRole('button', { name: 'Export MP4' }).click();
    await page.waitForFunction(() => document.querySelector('.replay-status').textContent.includes('Exported:'), null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.check.frames), expectedFrames);
    const result = JSON.parse(execFileSync(native, ['inspect', destination], { encoding: 'utf8' }));
    assert.equal(result.frames, expectedFrames); assert.equal(result.audio, 'aac'); assert.ok(result.audioPeak > 1000 && result.audioSamples > 130000); assert.ok(result.red > 100000 && result.blue > 100000);
    await page.getByRole('button', { name: 'Close narrated replay' }).click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.check.api.getSceneElements().map(e => ({ id: e.id, x: e.x, y: e.y })))), original);
    assert.equal(await page.evaluate(() => window.check.api.getSceneElements()[0].customData.exbasePresentation.bubble.shape), 'circle');
    assert.ok(await page.evaluate(() => window.check.releases >= 1));

    // Reopening restores the saved video and keeps source editing out of playback.
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    await page.waitForFunction(() => document.querySelector('.replay-bubble video').readyState >= 2);
    assert.ok(await page.evaluate(() => window.check.opens >= 1));
    assert.equal(await page.getByRole('button', { name: 'Edit visual description', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close narrated replay' }).click();
    // A canvas marked as needing generation still opens the original setup flow.
    await page.evaluate(() => {
      const elements = window.check.api.getSceneElements().map(e => e.customData?.exbasePresentation ? { ...e, version: e.version + 1, customData: { ...e.customData, exbasePresentation: { ...e.customData.exbasePresentation, needsGeneration: true } } } : e);
      window.check.api.updateScene({ elements });
    });
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    await page.getByRole('button', { name: 'Regenerate replay' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export MP4' }).count(), 0);
    assert.equal(await page.evaluate(() => window.check.api.getSceneElements()[0].customData.exbasePresentation.needsGeneration), true);
    await page.getByRole('textbox', { name: 'Visual description' }).fill('Two blue nodes with a clear connection.');
    await page.evaluate(() => { window.check.deferGeneration = true; });
    await page.getByRole('button', { name: 'Regenerate replay' }).click();
    await page.waitForFunction(() => !!window.check.rejectGeneration);
    await page.getByRole('button', { name: 'Cancel generation' }).click();
    await page.getByRole('button', { name: 'Regenerate replay' }).waitFor();
    await page.evaluate(() => { window.check.deferGeneration = false; });
    await page.getByRole('button', { name: 'Regenerate replay' }).click();
    await page.getByRole('button', { name: 'Export MP4' }).waitFor();
    assert.ok(await page.evaluate(() => window.check.generationPrompt.includes('Two blue nodes') && !window.check.generationPrompt.includes('set_presentation_timeline')));
    await page.getByRole('button', { name: 'Close narrated replay' }).click();
    await page.waitForFunction(() => window.check.savedScene?.elements[0]?.customData?.exbasePresentation?.visualDescription === 'Two blue nodes with a clear connection.');

    // Missing linked video offers relocation without losing the drawing.
    await page.evaluate(() => { window.check.missingVideo = true; });
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    await page.getByRole('button', { name: 'Locate video' }).waitFor();
    await page.getByRole('button', { name: 'Locate video' }).click();
    await page.waitForFunction(() => document.querySelector('.replay-bubble video').readyState >= 2);
    await page.getByRole('button', { name: 'Close narrated replay' }).click();
    await page.evaluate(() => { window.check.missingVideo = false; window.check.api.updateScene({ elements: [] }); });

    // The same menu starts a new replay on a blank canvas. Both files can be dropped together.
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    assert.ok(await page.getByRole('button', { name: 'Generate replay' }).isDisabled());
    assert.equal(await page.getByRole('button', { name: 'Choose files', exact: true }).count(), 0);
    await page.getByRole('textbox', { name: 'Visual description' }).click();
    assert.ok(await page.getByRole('dialog', { name: 'Narrated replay', exact: true }).isVisible());
    await page.screenshot({ path: path.join(artifacts, 'narrated-replay-empty.png') });
    await page.mouse.click(10, 400);
    await page.getByRole('dialog', { name: 'Narrated replay', exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Narrated replay' }).click();
    await page.evaluate(() => { const bounds = document.querySelector('.replay-assets').getBoundingClientRect(); window.check.drop(bounds.left + 20, bounds.top + 20, ['Synthetic.mp4', 'Synthetic.srt']); });
    await page.waitForFunction(() => document.querySelector('.replay-bubble video').readyState >= 2);
    await page.getByRole('textbox', { name: 'Visual description' }).fill('A compact diagram with two nodes.');
    await page.screenshot({ path: path.join(artifacts, 'narrated-replay-setup.png') });
    await page.getByRole('button', { name: 'Generate replay' }).click();
    await page.getByRole('button', { name: 'Export MP4' }).waitFor();
    const linked = await page.evaluate(() => window.check.api.getSceneElements()[0].customData.exbasePresentation);
    assert.equal(linked.srtPath, 'Synthetic.srt'); assert.equal(linked.videoPath, 'Synthetic.mp4'); assert.equal(linked.needsGeneration, false);
    await page.getByRole('button', { name: 'Close narrated replay' }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', source: 'synthetic only', ...result }));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'narrated-replay-failure.png') }); console.error(await page.locator('dialog.narrated-replay').evaluateAll((dialogs) => dialogs.map(d => ({ open: d.open, scrollTop: d.scrollTop, text: d.textContent, buttons: [...d.querySelectorAll('button')].map(b => ({ text: b.textContent, disabled: b.disabled, hidden: b.hidden })) })))); }
    throw error;
  } finally { if (encoder && encoder.exitCode === null) encoder.kill(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
