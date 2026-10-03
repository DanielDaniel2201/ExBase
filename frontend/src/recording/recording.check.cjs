// Run with wails dev active: node frontend/src/recording/recording.check.cjs
// Build the native check with scripts/build-recording.ps1 -Check first.
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const artifacts = path.resolve(__dirname, '../../../.tools/ui-check');
const nativeCheck = path.resolve(artifacts, '../recording-build/recording-check.exe');
const encoders = new Map();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.exposeFunction('checkBeginMP4', () => {
      const id = randomUUID(), file = path.join(artifacts, id + '.mp4');
      const command = spawn(nativeCheck, ['encode', file]);
      const done = new Promise((resolve, reject) => { command.on('error', reject); command.on('close', (code) => code === 0 ? resolve() : reject(Error('test MP4 encoder exited ' + code))); });
      done.catch(() => {}); command.stdin.on('error', () => {});
      encoders.set(id, { command, done, file }); return id;
    });
    await page.exposeFunction('checkAppendFrame', (id, frame) => new Promise((resolve, reject) => { const data = Buffer.from(frame, 'base64'); const length = Buffer.alloc(4); length.writeUInt32LE(data.length); encoders.get(id).command.stdin.write(Buffer.concat([length, data]), (error) => error ? reject(error) : resolve()); }));
    await page.exposeFunction('checkFinishMP4', async (id) => {
      const encoder = encoders.get(id); encoder.command.stdin.end(); await encoder.done;
      const encoded = fs.readFileSync(encoder.file).toString('base64'); fs.unlinkSync(encoder.file); encoders.delete(id); return encoded;
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/src/App.jsx*', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('excalidrawAPI: setApi', 'excalidrawAPI: (value) => { window.check.api = value; setApi(value); }');
      assert.ok(body.includes('window.check.api = value'), 'expose canvas API in test page');
      await route.fulfill({ response, body });
    });
    await page.addInitScript(() => {
      window.EXCALIDRAW_ASSET_PATH = '/';
      window.check = { general: { slidesEnabled: false, recordingEnabled: false, recordingMode: 'canvas', recordingMicrophone: true }, listeners: new Map(), recording: null, videos: [], quits: 0, saves: 0, applicationFrames: 0, emitCloseDuringSave: true };
      const scene = (color) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: color, type: 'rectangle', x: 0, y: 0, width: 360, height: 220, strokeColor: color, backgroundColor: color, fillStyle: 'solid', roughness: 0, strokeWidth: 1 }], appState: {}, files: {} });
      const docs = [
        { path: 'D:\\check\\Red.excalidraw', data: scene('#ff0000') },
        { path: 'D:\\check\\Blue.excalidraw', data: scene('#0000ff') },
      ];
      window.go = { main: { App: {
        Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }),
        ReadDirectory: async () => docs.map((doc) => ({ path: doc.path, name: doc.path.split('\\').pop(), isDir: false })),
        OpenDocument: async (p) => docs.find((doc) => doc.path === p),
        Save: async () => { window.check.saves++; },
        LoadGeneralSettings: async () => window.check.general,
        SaveGeneralSettings: async (value) => { window.check.general = value; },
        LoadAISettings: async () => ({ apiKey: '', hasAPIKey: false }),
        LoadPromptTemplates: async () => [],
        CaptureApplicationFrame: async () => {
          window.check.applicationFrames++;
          if (window.check.failNativeCapture) throw Error('Native capture interrupted');
          const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
          const context = canvas.getContext('2d'); context.fillStyle = '#00ff00'; context.fillRect(0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png');
        },
        BeginMP4Recording: async () => { assertIdle(); const id = await window.checkBeginMP4(); window.check.recording = { id, format: 'mp4', chunks: [], frames: 0, microphone: false }; return id; },
        AppendRecordingFrame: async (id, frame) => { if (window.check.recording.id !== id) throw Error('stale recording'); await window.checkAppendFrame(id, frame); window.check.recording.frames++; },
        StartRecordingMicrophone: async (id) => { if (window.check.recording.id !== id) throw Error('stale microphone'); window.check.recording.microphone = true; },
        FinishRecording: async (id) => { if (window.check.recording.id !== id) throw Error('stale finish'); if (window.check.emitCloseDuringSave) window.check.listeners.get('recording:close-requested')?.(); const data = await window.checkFinishMP4(id); window.check.recording.chunks.push(data); window.check.videos.push(window.check.recording); window.check.recording = null; return 'D:\\check\\recording.mp4'; },
        AbortRecording: async () => { window.check.recording = null; },
      } } };
      function assertIdle() { if (window.check.recording) throw Error('already recording'); }
      window.runtime = {
        EventsOnMultiple: (name, fn) => { window.check.listeners.set(name, fn); return () => window.check.listeners.delete(name); },
        Quit: () => { window.check.quits++; }, WindowMinimise: () => {}, WindowToggleMaximise: () => {},
      };
    });
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    await page.getByRole('button', { name: 'Red.excalidraw' }).click();
    await page.waitForFunction(() => !!window.check.api && !!document.querySelector('canvas.static')?.width);
    await page.evaluate(() => { window.check.baseElement = window.check.api.getSceneElements()[0]; });
    assert.equal(await page.getByRole('button', { name: 'Add-ons', exact: true }).count(), 0);
    const settings = async () => { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('switch', { name: 'Enable screen recording' }).waitFor(); };
    await settings();
    await page.getByRole('switch', { name: 'Frame slide preview' }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    assert.equal(await page.getByRole('button', { name: 'Add-ons', exact: true }).count(), 0, 'slides require valid frames');
    await settings();
    await page.getByRole('switch', { name: 'Enable screen recording' }).check();
    await page.waitForFunction(() => window.check.general.recordingEnabled);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(artifacts, 'recording-settings.png') });
    await page.getByRole('button', { name: 'Close settings' }).click();
    const addons = page.getByRole('button', { name: 'Add-ons', exact: true });
    await addons.click();
    assert.equal(await page.getByRole('menuitem', { name: 'Preview slides' }).count(), 0);
    const menuBox = await page.getByRole('menu', { name: 'Add-ons' }).boundingBox();
    assert.ok(menuBox.y + menuBox.height < (await addons.boundingBox()).y, 'menu opens upward');
    await page.screenshot({ path: path.join(artifacts, 'recording-menu.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await addons.click();
    await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).click();
    await page.waitForFunction(() => !!window.check.recording);
    await page.waitForTimeout(1400);
    await settings();
    assert.ok(await page.getByRole('switch', { name: 'Enable screen recording' }).isDisabled());
    // An opaque modal covering the canvas must not appear in the video.
    await page.locator('.settings-modal').evaluate((dialog) => { dialog.style.background = '#00ff00'; });
    await page.waitForTimeout(1400);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Blue.excalidraw' }).click();
    await page.waitForFunction(() => window.check.api.getSceneElements()[0]?.backgroundColor === '#0000ff');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(1400);
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(1000);
    await page.locator('.recording-status').click();
    await page.waitForFunction(() => window.check.videos.length === 1 && !window.check.recording);
    assert.equal(await page.evaluate(() => window.check.quits), 0, 'normal stop and late native close events must not quit');
    assert.ok(await page.evaluate(() => window.check.videos[0].frames > 20), 'PNG frames are streamed to the native encoder');
    assert.equal(await page.evaluate(() => window.check.videos[0].microphone), true, 'microphone is enabled by default');
    assert.equal(await page.evaluate(() => window.check.videos[0].format), 'mp4');
    fs.writeFileSync(path.join(artifacts, 'recording-canvas.mp4'), Buffer.concat((await page.evaluate(() => window.check.videos[0].chunks)).map((s) => Buffer.from(s, 'base64'))));
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await settings();
    await page.getByRole('radio', { name: 'Canvas only, lock navigation' }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await addons.click();
    await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('aside')?.inert);
    assert.ok(await page.locator('aside').evaluate((node) => node.inert));
    assert.equal(await page.locator('.window-controls').evaluate((node) => node.inert), false);
    assert.ok(await page.getByRole('button', { name: 'Minimise' }).isEnabled());
    assert.ok(await page.getByRole('button', { name: 'Maximise' }).isEnabled());
    await page.screenshot({ path: path.join(artifacts, 'recording-locked.png') });
    // A physical click on an inert file cannot switch documents.
    const red = await page.locator('button.tree-row').filter({ hasText: 'Red.excalidraw' }).boundingBox();
    await page.mouse.click(red.x + 30, red.y + red.height / 2);
    assert.equal(await page.evaluate(() => window.check.api.getSceneElements()[0].backgroundColor), '#0000ff');
    const canvas = await page.locator('canvas.interactive').boundingBox();
    await page.mouse.click(canvas.x + 650, canvas.y + 200);
    await page.keyboard.press('r');
    await page.mouse.move(canvas.x + 650, canvas.y + 200); await page.mouse.down();
    await page.mouse.move(canvas.x + 750, canvas.y + 280, { steps: 10 }); await page.mouse.up();
    await page.waitForFunction(() => window.check.api.getSceneElements().length > 1);
    await page.keyboard.press('t');
    await page.mouse.click(canvas.x + 400, canvas.y + 180);
    await page.locator('textarea.excalidraw-wysiwyg').waitFor();
    await page.keyboard.type('Recording text');
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    // Native close is deferred until the final chunk and save finish.
    await page.evaluate(() => window.check.listeners.get('recording:close-requested')());
    await page.waitForFunction(() => window.check.quits === 1 && window.check.videos.length === 2);
    assert.equal(await page.locator('aside').evaluate((node) => node.inert), false);
    fs.writeFileSync(path.join(artifacts, 'recording-locked.mp4'), Buffer.concat((await page.evaluate(() => window.check.videos[1].chunks)).map((s) => Buffer.from(s, 'base64'))));
    // Blank canvases still offer recording; both disabled hides the add-ons button.
    await page.evaluate(() => {
      window.check.api.updateScene({ elements: [] });
      window.check.general.recordingMicrophone = false;
      // The broken WebView2 video encoder must never be used again.
      window.MediaRecorder = class { constructor() { throw Error('Browser video encoder must not be used'); } static isTypeSupported() { return false; } };
    });
    await addons.click();
    await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).click();
    await page.waitForFunction(() => !!window.check.recording);
    await page.waitForTimeout(1100);
    await page.locator('.recording-status').click();
    await page.waitForFunction(() => window.check.videos.length === 3);
    assert.equal(await page.evaluate(() => window.check.videos[2].format), 'mp4');
    assert.equal(await page.evaluate(() => window.check.videos[2].microphone), false);
    fs.writeFileSync(path.join(artifacts, 'recording-silent.mp4'), Buffer.concat((await page.evaluate(() => window.check.videos[2].chunks)).map((s) => Buffer.from(s, 'base64'))));
    // Both menu entries appear once the existing Frame requirements are met.
    await page.evaluate(() => {
      window.check.api.updateScene({ elements: [{ ...window.check.baseElement, type: 'frame', id: 'slide', name: 'Slide', x: 0, y: 0, width: 400, height: 250, backgroundColor: 'transparent' }] });
    });
    await addons.click();
    await page.getByRole('menuitem', { name: 'Preview slides' }).waitFor();
    assert.equal(await page.getByRole('menuitem').count(), 2);
    await page.screenshot({ path: path.join(artifacts, 'recording-addons.png') });
    await addons.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Preview slides');
    await page.keyboard.press('Escape');
    // App mode uses only the native ExBase source, with no browser sharing API.
    await settings();
    await page.getByRole('radio', { name: 'Entire application' }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.evaluate(() => {
      window.check.displayRequests = 0;
      navigator.mediaDevices.getDisplayMedia = async () => { window.check.displayRequests++; throw Error('Browser sharing picker must never be used'); };
    });
    await addons.click();
    await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).click();
    await page.waitForFunction(() => !!window.check.recording && window.check.applicationFrames > 2);
    assert.equal(await page.evaluate(() => window.check.displayRequests), 0);
    assert.equal(await page.locator('aside').evaluate((node) => node.inert), false);
    await settings();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.waitForTimeout(1200);
    await page.locator('.recording-status').click();
    await page.waitForFunction(() => window.check.videos.length === 4);
    assert.equal(await page.evaluate(() => window.check.quits), 1, 'stopping app recording must not quit');
    fs.writeFileSync(path.join(artifacts, 'recording-app.mp4'), Buffer.concat((await page.evaluate(() => window.check.videos[3].chunks)).map((s) => Buffer.from(s, 'base64'))));
    // Source failures stop and save captured frames while leaving the app open.
    await addons.click();
    await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).click();
    await page.waitForFunction(() => !!window.check.recording);
    await page.waitForTimeout(1100);
    await page.evaluate(() => { window.check.failNativeCapture = true; });
    await page.waitForFunction(() => window.check.videos.length === 5 && !window.check.recording);
    await page.getByRole('alert').filter({ hasText: 'Native capture interrupted' }).waitFor();
    assert.equal(await page.evaluate(() => window.check.quits), 1, 'source ending must never quit');
    assert.equal(await page.evaluate(() => window.check.recording), null);
    await settings();
    await page.getByRole('switch', { name: 'Frame slide preview' }).uncheck();
    await page.getByRole('switch', { name: 'Enable screen recording' }).uncheck();
    await page.getByRole('button', { name: 'Close settings' }).click();
    assert.equal(await addons.count(), 0);
    assert.deepEqual(errors, []);
    const video = path.join(artifacts, 'recording-canvas.mp4');
    const metadata = JSON.parse(execFileSync(nativeCheck, ['inspect', video], { encoding: 'utf8' }));
    assert.equal(metadata.width, 1920);
    assert.equal(metadata.height, 1080);
    assert.equal(metadata.video, 'h264');
    const silent = JSON.parse(execFileSync(nativeCheck, ['inspect', path.join(artifacts, 'recording-silent.mp4')], { encoding: 'utf8' }));
    assert.equal(silent.audio, 'none');
    await page.evaluate(async () => {
      const chunks = window.check.videos[0].chunks.map((encoded) => Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
      const video = document.createElement('video'); video.muted = true;
      video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
      const loaded = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('MP4 playback failed')); });
      document.body.append(video); await loaded;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!(video.currentTime > 0)) throw Error('MP4 playback did not advance');
      video.pause(); URL.revokeObjectURL(video.src); video.remove();
    });
    assert.ok(metadata.red > 10000 && metadata.blue > 10000, 'both files appear in the decoded video');
    assert.equal(metadata.green, 0, 'Settings modal must not appear in decoded video');
    console.log('PASS: native H.264 MP4 encoding/playback/pixels, microphone switch, no browser video encoder, continuous file switches/resize, navigation lock, native app source, safe stop and explicit close.');
  } finally { for (const encoder of encoders.values()) encoder.command.kill(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
