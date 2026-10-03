// Run in wails dev by temporarily calling runNativeHookCheck() from App.jsx.
// Uses the production hook, real PNG bridge, WASAPI and Media Foundation.
// Only the save dialog is replaced with finalization into recovery files.
import React from "react";
import { createRoot } from "react-dom/client";
import { useRecording } from "./useRecording";

export async function runNativeHookCheck() {
  if (!import.meta.env.DEV || !window.chrome?.webview) return;
  const app = window.go.main.App;
  const original = { begin: app.BeginMP4Recording, frame: app.AppendRecordingFrame, microphone: app.StartRecordingMicrophone, finish: app.FinishRecording };
  const results = []; let active;
  app.BeginMP4Recording = async (...args) => { const id = await original.begin(...args); active.id = id; return id; };
  app.AppendRecordingFrame = async (...args) => { await original.frame(...args); active.frames++; };
  app.StartRecordingMicrophone = async (...args) => { await original.microphone(...args); active.microphoneStarted = true; };
  app.FinishRecording = async (id) => { const path = await app.FinalizeRecording(id); active.path = path; await app.AbortRecording(id); return path; };
  const fixture = document.createElement("div"); fixture.className = "canvas";
  fixture.style.cssText = "position:fixed;top:0;left:0;width:12px;height:8px;pointer-events:none";
  const canvas = document.createElement("canvas"); canvas.className = "static"; canvas.width = 1960; canvas.height = 1246; canvas.style.cssText = "width:12px;height:8px";
  fixture.append(canvas); document.body.prepend(fixture);
  const context = canvas.getContext("2d");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const api = { getAppState: () => ({ viewBackgroundColor: "#fff" }) };
  let control;
  function Harness() { control = useRecording(api, { path: "native-hook.excalidraw" }, (status) => { if (active) active.status = status; }); return null; }
  root.render(<Harness />);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    await pause(100);
    for (const [mode, animated, microphone] of [["canvas", false, true], ["canvas", false, false], ["canvas", true, true], ["canvas-locked", true, true], ["app", false, true]]) {
      active = { mode, animated, microphone, frames: 0 }; results.push(active);
      context.fillStyle = "red"; context.fillRect(0, 0, canvas.width, canvas.height);
      let count = 0;
      const timer = animated ? setInterval(() => { context.fillStyle = ++count % 2 ? "red" : "blue"; context.fillRect(0, 0, canvas.width, canvas.height); }, 100) : null;
      try {
        await control.start(mode, microphone); await pause(2000);
        if (!(await control.stop()) || !active.path || !active.frames || (microphone && !active.microphoneStarted)) throw Error(`Native check failed for ${mode}`);
      } finally { clearInterval(timer); }
    }
    return results;
  } catch (error) { results.push({ error: String(error) }); throw error; }
  finally {
    root.unmount(); host.remove(); fixture.remove();
    app.BeginMP4Recording = original.begin; app.AppendRecordingFrame = original.frame; app.StartRecordingMicrophone = original.microphone; app.FinishRecording = original.finish;
    const id = await app.BeginRecording("native-MP4-report", "webm");
    const reader = new FileReader();
    const encoded = new Promise((resolve) => { reader.onload = () => resolve(reader.result.split(",")[1]); });
    reader.readAsDataURL(new Blob([JSON.stringify({ nativeMP4: results })]));
    await app.AppendRecording(id, await encoded); await app.AbortRecording(id);
  }
}
