// With wails dev running; build native fixtures with scripts/build-recording.ps1 -Check.
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const artifacts = path.resolve(__dirname, '../../../.tools/ui-check');
const native = path.resolve(artifacts, '../recording-build/recording-check.exe');
const source = path.resolve(artifacts, '../recording-build/tone.mp4');
const destination = path.join(artifacts, 'recording-editor.mp4');
assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../App.jsx'), 'utf8'), /WebcamBubble|webcamPreview/, 'application never mounts a live webcam overlay');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let encoder, done;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
    // HMR is unnecessary in a one-shot harness; keep CSS injection active.
    await page.route('**/@vite/client*', route => route.fulfill({contentType:'text/javascript',body:`
      export const createHotContext = () => ({accept(){}, dispose(){}, prune(){}, on(){}, invalidate(){}});
      export function updateStyle(id, css) { let style = document.getElementById(id); if (!style) { style = document.createElement('style'); style.id=id; document.head.append(style); } style.textContent=css; }
      export function removeStyle(id) { document.getElementById(id)?.remove(); }
      export const injectQuery = (url) => url;
    `}));
    await page.exposeFunction('checkBeginExport', () => {
      encoder = spawn(native, ['encode-presentation', destination, source]);
      let stderr = ''; encoder.stderr.on('data', (data) => stderr += data);
      done = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', (code) => code === 0 ? resolve() : reject(Error(stderr))); });
      done.catch(() => {}); return 'export';
    });
    await page.exposeFunction('checkAppend', (frame) => new Promise((resolve, reject) => {
      const data = Buffer.from(frame, 'base64'), length = Buffer.alloc(4); length.writeUInt32LE(data.length);
      encoder.stdin.write(Buffer.concat([length, data]), (error) => error ? reject(error) : resolve());
    }));
    await page.exposeFunction('checkFinish', async () => { encoder.stdin.end(); await done; return destination; });
    await page.route('**/presentation-media/check', (route) => {
      // A valid MP4 over 10 MB verifies that the old bridge size limit is gone.
      const data = Buffer.concat([fs.readFileSync(source), Buffer.alloc(11 << 20)]);
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (!range) return route.fulfill({ contentType: 'video/mp4', body: data });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes' }, body: data.subarray(start, end + 1) });
    });
    await page.route('**/editor-check', (route) => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      const { createRoot } = ReactDOM;
      import { useRecording } from '/src/recording/useRecording.js';
      import { VideoEditor } from '/src/recording/VideoEditor.jsx';
      import { RecordingSetup } from '/src/recording/RecordingSetup.jsx';
      import '/src/style.css';
      const h = React.createElement;
      const fixture = document.createElement('div'); fixture.className = 'canvas';
      const canvas = document.createElement('canvas'); canvas.className = 'static'; canvas.width = 1920; canvas.height = 1080; canvas.style.width = '600px';
      canvas.getContext('2d').fillRect(0,0,1920,1080); fixture.append(canvas); document.body.append(fixture);
      const api = { getAppState: () => ({ viewBackgroundColor: '#fff' }) };
      function Harness() {
        const control = useRecording(api, {path:'D:/check/Canvas.excalidraw'}, () => {}); window.check.control = control;
        const [setup, setSetup] = React.useState(false);
        const cancel = () => setSetup(false);
        return h(React.Fragment,null,
          h('button',{onClick:()=>setSetup(true)},'Setup'),
          h('button',{onClick:()=>control.stop()},'Stop'),
          setup && h(RecordingSetup,{onCancel:cancel,onStart:(config)=>{cancel();control.start('canvas',true,config.webcamEnabled);}}),
          control.recordedVideos.screen && h(VideoEditor,{screenRecording:control.recordedVideos.screen,webcamRecording:control.recordedVideos.webcam,document:'D:/check/Canvas.excalidraw',onClose:control.clearRecordedVideos,onExport:control.saveRecording}),
          control.notice && h('p',{role:'status'},control.notice.text));
      }
      createRoot(document.getElementById('root')).render(h(Harness));
    </script>` }));
    await page.addInitScript(() => {
      window.check = { streams: [], saves: 0, prepared: 0, released: 0, recording: null, listeners: new Map() };
      navigator.mediaDevices.getUserMedia = async () => {
        const camera = document.createElement('canvas'); camera.width = 640; camera.height = 480;
        const ctx = camera.getContext('2d');
        const paint = () => { ctx.fillStyle = '#00ff00'; ctx.fillRect(0,0,640,480); ctx.fillStyle = 'red'; ctx.fillRect(0,0,80,480); ctx.fillStyle = 'blue'; ctx.fillRect(560,0,80,480); };
        paint(); const timer = setInterval(paint,50), stream = camera.captureStream(20);
        const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        window.check.streams.push(stream); return stream;
      };
      window.go = { main: { App: {
        BeginMP4Recording: async () => { window.check.recording = 'capture'; return 'capture'; },
        StartRecordingMicrophone: async () => {},
        AppendRecordingFrame: async (id, frame) => { if (id === 'export') await window.checkAppend(frame); },
        PrepareRecording: async () => { window.check.prepared++; window.check.recording = null; return { token: 'check', url: '/presentation-media/check' }; },
        SaveRecordingVideo: async () => { window.check.saves++; return 'saved.mp4'; },
        ReleasePresentationVideo: async () => { window.check.released++; },
        BeginPresentationExport: async () => { window.check.recording = 'export'; return window.checkBeginExport(); },
        FinishRecording: async () => { window.check.saves++; const path = await window.checkFinish(); window.check.recording = null; return path; },
        AbortRecording: async () => { window.check.recording = null; },
      } } };
      window.runtime = { EventsOnMultiple: (name, fn) => { window.check.listeners.set(name,fn); return () => window.check.listeners.delete(name); }, Quit: () => {} };
    });
    await page.goto('http://localhost:5173/editor-check');
    await page.getByRole('button',{name:'Setup',exact:true}).click();
    await page.getByRole('checkbox',{name:'Enable Webcam'}).check();
    assert.equal(await page.locator('.webcam-bubble').count(), 0, 'setup shows no webcam bubble');
    assert.equal(await page.evaluate(() => window.check.streams.length), 0, 'setup does not open a preview camera');
    await page.getByRole('button',{name:'Start Recording',exact:true}).click();
    await page.waitForFunction(() => window.check.control.recording.phase === 'recording');
    assert.equal(await page.locator('.webcam-bubble').count(), 0, 'recording shows no webcam bubble');
    assert.equal(await page.evaluate(() => window.check.streams.length), 1, 'only one camera opened for recording');
    assert.equal(await page.evaluate(() => window.check.streams.filter(s => s.getTracks().some(t => t.readyState === 'live')).length), 1, 'camera still records without a visible bubble');
    await page.waitForTimeout(3300);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('button',{name:'Export Video',exact:true}).waitFor({timeout:20000});
    assert.equal(await page.locator('.video-editor-loading').count(),0);
    assert.equal(await page.evaluate(() => window.check.saves),0,'stop never opens save dialog');
    assert.equal(await page.evaluate(() => window.check.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))),true,'all camera tracks stopped');
    const pixels = await page.locator('.video-editor-canvas').evaluate(canvas => [60,140,220].map(x=>[...canvas.getContext('2d').getImageData(x,140,1,1).data]));
    assert.ok(pixels.every(pixel=>pixel[1]>200 && pixel[0]<60 && pixel[2]<60),'webcam excludes both landscape sides instead of squeezing them into a square');
    // Moving and hiding the editor bubble must expose the clean screen below.
    const preview = page.locator('.video-editor-canvas');
    const box = await preview.boundingBox(), scale = box.width / 1920;
    await page.mouse.move(box.x + 140 * scale, box.y + 140 * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + 740 * scale, box.y + 540 * scale);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.video-editor-canvas').getContext('2d').getImageData(740,540,1,1).data[1] > 200);
    assert.ok(await preview.evaluate(canvas => canvas.getContext('2d').getImageData(140,140,1,1).data[1] < 60), 'no duplicate bubble at its original position');
    const size = page.locator('.video-editor-section input[type="range"]');
    await size.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await page.getByText('Size: 101px', {exact:true}).waitFor();
    await page.getByRole('button',{name:'Rounded',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.video-editor-canvas').getContext('2d').getImageData(700,500,1,1).data[1] > 200);
    await page.getByRole('checkbox',{name:'Show webcam',exact:true}).uncheck();
    await page.waitForFunction(() => document.querySelector('.video-editor-canvas').getContext('2d').getImageData(700,500,1,1).data[1] < 60);
    await page.getByRole('checkbox',{name:'Show webcam',exact:true}).check();
    await page.waitForFunction(() => document.querySelector('.video-editor-canvas').getContext('2d').getImageData(700,500,1,1).data[1] > 200);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.video-editor video').currentTime > .2);
    assert.equal(await page.locator('.video-editor video').first().evaluate(v=>v.muted),false,'screen audio unmuted');
    await page.getByRole('button',{name:'Export Video',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Recording saved:'}).waitFor({timeout:60000});
    const metadata = JSON.parse(execFileSync(native,['inspect',destination],{encoding:'utf8'}));
    assert.ok(metadata.green>8000 && metadata.red>10000 && metadata.blue>10000,'export contains screen and the resized webcam');
    assert.ok(metadata.audioPeak>1000 && metadata.audioSamples>100000,'original sound survives composition');
    assert.equal(await page.locator('.video-editor-overlay').count(),0);
    // No-camera recordings still open the editor and close without stale native state.
    await page.evaluate(()=>window.check.control.start('canvas',false,false));
    await page.waitForTimeout(300); await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('button',{name:'Export Video',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close editor'}).click();
    await page.waitForFunction(()=>window.check.released===2);
    assert.equal(await page.evaluate(()=>window.check.recording),null);
    assert.deepEqual(errors,[]);
    console.log('PASS: no setup/recording bubble, independent camera cleanup, editor drag/resize/hide without duplicates, >10 MB seekable preview, center crop, audible playback, native H.264/AAC composite, no-camera close.');
  } finally { encoder?.kill(); await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
