import { useEffect, useRef, useState } from "react";
import { AbortRecording, AppendRecordingFrame, BeginMP4Recording, FinishRecording, StartRecordingMicrophone, SetRecordingWebcam, DisableRecordingWebcam } from "../../wailsjs/go/main/App";
import { EventsOn, Quit } from "../../wailsjs/runtime/runtime";
import { recordingFrames } from "./capture";

export function useRecording(api, doc, onStatus) {
  const [recording, setRecording] = useState({ phase: "idle", mode: null, seconds: 0, webcamEnabled: false });
  const [notice, setNotice] = useState(null);
  const [recordedVideos, setRecordedVideos] = useState({ screen: null, webcam: null });
  const current = useRef(null);
  const apiRef = useRef(api); apiRef.current = api;
  const callbacks = useRef();
  const webcamRecorderRef = useRef(null);

  async function stop() {
    const state = current.current;
    if (!state) return true;
    if (state.done) return state.done;
    if (!state.ready) { state.cancelled = true; await state.initialized; return true; }
    state.stopping = true;
    setRecording((value) => ({ ...value, phase: "stopping", webcamEnabled: false }));
    state.done = (async () => {
      clearInterval(state.clock); clearTimeout(state.timer);
      await state.frameWrite?.catch((error) => { state.error = String(error); });
      state.capture.dispose();

      // Stop webcam recording
      if (state.webcamRecorder) {
        state.webcamRecorder.stop();
        // Wait a bit for onstop to process
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      let completed = false;
      try {
        const path = await FinishRecording(state.id);

        // If webcam was recorded, save for editing
        if (state.webcamBlob && path) {
          const webcamUrl = URL.createObjectURL(state.webcamBlob);
          setRecordedVideos({ screen: path, webcam: webcamUrl });
        }

        const result = path ? `Recording saved: ${path}` : "Recording discarded.";
        const text = state.error ? `${state.error} ${result}` : result;
        onStatus(text); setNotice({ text, error: !!state.error }); completed = true;
      } catch (error) {
        onStatus(String(error)); setNotice({ text: String(error), error: true });
        await AbortRecording(state.id).catch(() => {});
      } finally {
        if (current.current === state) current.current = null;
        setRecording({ phase: "idle", mode: null, seconds: 0, webcamEnabled: false });
      }
      return completed;
    })();
    return state.done;
  }

  async function start(mode, microphone = true, webcam = false, webcamConfig = null) {
    if (current.current || !apiRef.current) return;
    const state = { mode, cancelled: false, webcamConfig };
    state.initialized = new Promise((resolve) => { state.initializeDone = resolve; });
    current.current = state;
    setRecording({ phase: "starting", mode, seconds: 0, webcamEnabled: webcam }); onStatus(""); setNotice(null);

    try {
      // Start webcam recording if enabled
      if (webcam) {
        try {
          const webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" },
            audio: false
          });

          const webcamRecorder = new MediaRecorder(webcamStream, {
            mimeType: 'video/webm;codecs=vp8',
            videoBitsPerSecond: 2500000
          });

          const webcamChunks = [];
          webcamRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) webcamChunks.push(e.data);
          };

          webcamRecorder.onstop = () => {
            const webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
            state.webcamBlob = webcamBlob;
            webcamStream.getTracks().forEach(track => track.stop());
          };

          webcamRecorder.start(100); // Capture chunks every 100ms
          state.webcamRecorder = webcamRecorder;
          webcamRecorderRef.current = webcamRecorder;
        } catch (err) {
          console.error("Webcam recording failed:", err);
          // Continue without webcam
        }
      }

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
      setRecording({ phase: "recording", mode, seconds: 0, webcamEnabled: webcam });
      state.clock = setInterval(() => setRecording((value) => ({ ...value, seconds: Math.floor((Date.now() - state.started) / 1000) })), 1000);
    } catch (error) {
      state.capture?.dispose();
      if (state.id) await AbortRecording(state.id).catch(() => {});
      if (current.current === state) current.current = null;
      setRecording({ phase: "idle", mode: null, seconds: 0, webcamEnabled: false });
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
  return {
    recording,
    start,
    stop,
    notice,
    dismissNotice: () => setNotice(null),
    locked: recording.phase !== "idle" && recording.mode === "canvas-locked",
    recordedVideos,
    clearRecordedVideos: () => {
      if (recordedVideos.webcam) {
        URL.revokeObjectURL(recordedVideos.webcam);
      }
      setRecordedVideos({ screen: null, webcam: null });
    }
  };
}
