import { useEffect, useRef, useState } from "react";
import { AbortRecording, AppendRecordingFrame, BeginMP4Recording, FinishRecording, StartRecordingMicrophone } from "../../wailsjs/go/main/App";
import { EventsOn, Quit } from "../../wailsjs/runtime/runtime";
import { recordingFrames } from "./capture";

export function useRecording(api, doc, onStatus) {
  const [recording, setRecording] = useState({ phase: "idle", mode: null, seconds: 0 });
  const [notice, setNotice] = useState(null);
  const current = useRef(null);
  const apiRef = useRef(api); apiRef.current = api;
  const callbacks = useRef();

  async function stop() {
    const state = current.current;
    if (!state) return true;
    if (state.done) return state.done;
    if (!state.ready) { state.cancelled = true; await state.initialized; return true; }
    state.stopping = true;
    setRecording((value) => ({ ...value, phase: "stopping" }));
    state.done = (async () => {
      clearInterval(state.clock); clearTimeout(state.timer);
      await state.frameWrite?.catch((error) => { state.error = String(error); });
      state.capture.dispose();
      let saved = false;
      try {
        const path = await FinishRecording(state.id);
        const text = state.error ? `${state.error} Captured video saved: ${path}` : `Recording saved: ${path}`;
        onStatus(text); setNotice({ text, error: !!state.error }); saved = true;
      } catch (error) {
        onStatus(String(error)); setNotice({ text: String(error), error: true });
        await AbortRecording(state.id).catch(() => {});
      } finally {
        if (current.current === state) current.current = null;
        setRecording({ phase: "idle", mode: null, seconds: 0 });
      }
      return saved;
    })();
    return state.done;
  }

  async function start(mode, microphone = true) {
    if (current.current || !apiRef.current) return;
    const state = { mode, cancelled: false };
    state.initialized = new Promise((resolve) => { state.initializeDone = resolve; });
    current.current = state;
    setRecording({ phase: "starting", mode, seconds: 0 }); onStatus(""); setNotice(null);
    try {
      state.capture = await recordingFrames(mode, () => apiRef.current);
      const firstFrame = await state.capture.frame();
      if (state.cancelled) throw Error("Recording cancelled.");
      state.id = await BeginMP4Recording(doc?.path || "ExBase", microphone);
      await AppendRecordingFrame(state.id, firstFrame);
      if (state.cancelled) throw Error("Recording cancelled.");
      if (microphone) await StartRecordingMicrophone(state.id);
      if (state.cancelled) throw Error("Recording cancelled.");
      state.ready = true; state.started = Date.now();
      const tick = async () => {
        const started = performance.now();
        try {
          state.frameWrite = (async () => { const frame = await state.capture.frame(); if (!state.stopping) await AppendRecordingFrame(state.id, frame); })();
          await state.frameWrite;
          if (!state.stopping) state.timer = setTimeout(tick, Math.max(0, 50 - (performance.now() - started)));
        } catch (error) { state.error = String(error); state.frameWrite = Promise.resolve(); stop(); }
      };
      state.timer = setTimeout(tick, 50);
      setRecording({ phase: "recording", mode, seconds: 0 });
      state.clock = setInterval(() => setRecording((value) => ({ ...value, seconds: Math.floor((Date.now() - state.started) / 1000) })), 1000);
    } catch (error) {
      state.capture?.dispose();
      if (state.id) await AbortRecording(state.id).catch(() => {});
      if (current.current === state) current.current = null;
      setRecording({ phase: "idle", mode: null, seconds: 0 });
      const text = String(error);
      onStatus(text); setNotice({ text, error: true });
    } finally { state.initializeDone(); }
  }

  callbacks.current = { stop };
  useEffect(() => EventsOn("recording:close-requested", async () => {
    const state = current.current;
    if (!state || state.done) return;
    if (await callbacks.current.stop()) Quit();
  }), []);
  useEffect(() => () => {
    const state = current.current;
    if (!state) return;
    state.cancelled = true;
    if (state.ready) callbacks.current.stop();
    else state.capture?.dispose();
  }, []);
  return { recording, start, stop, notice, dismissNotice: () => setNotice(null), locked: recording.phase !== "idle" && recording.mode === "canvas-locked" };
}
