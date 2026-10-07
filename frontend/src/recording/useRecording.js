import { useEffect, useRef, useState } from "react";
import { AbortRecording, AppendRecordingFrame, BeginMP4Recording, StartRecordingMicrophone, PrepareRecording, SaveRecordingVideo, FinishRecording, ReleasePresentationVideo } from "../../wailsjs/go/main/App";
import { EventsOn, Quit } from "../../wailsjs/runtime/runtime";
import { recordingFrames } from "./capture";

export function useRecording(api, doc, onStatus) {
  const [recording, setRecording] = useState({ phase: "idle", mode: null, seconds: 0, webcamEnabled: false });
  const [notice, setNotice] = useState(null);
  const [recordedVideos, setRecordedVideos] = useState({ screen: null, webcam: null });
  const current = useRef(null);
  const apiRef = useRef(api); apiRef.current = api;
  const callbacks = useRef();
  const videosRef = useRef(null);
  const closing = useRef(false);
  const exporting = useRef(false);

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

      let completed = false;
      try {
        if (state.webcamRecorder && state.webcamRecorder.state !== "inactive") state.webcamRecorder.stop();
        state.webcamStream?.getTracks().forEach(track => track.stop());
        await state.webcamStopped;
        const screen = await PrepareRecording(state.id);
        const videos = { screen, webcam: state.webcamBlob?.size ? URL.createObjectURL(state.webcamBlob) : null, document: state.document };
        videosRef.current = videos;
        setRecordedVideos(videos);
        if (state.error) { onStatus(state.error); setNotice({ text: state.error, error: true }); }
        completed = true;
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

  async function start(mode, microphone = true, webcam = false) {
    if (current.current || videosRef.current || !apiRef.current) return;
    closing.current = false;
    const state = { mode, cancelled: false, document: doc?.path };
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

          state.webcamStream = webcamStream;
          const webcamRecorder = new MediaRecorder(webcamStream, {
            mimeType: 'video/webm;codecs=vp8',
            videoBitsPerSecond: 2500000
          });

          const webcamChunks = [];
          webcamRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) webcamChunks.push(e.data);
          };

          state.webcamStopped = new Promise((resolve, reject) => {
            webcamRecorder.onerror = (event) => reject(event.error || Error("Webcam recording failed."));
            webcamRecorder.onstop = () => {
              state.webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
              webcamStream.getTracks().forEach(track => track.stop());
              resolve();
            };
          });
          state.webcamStopped.catch(() => {});

          state.webcamRecorder = webcamRecorder;
        } catch (err) {
          console.error("Webcam recording failed:", err);
          state.webcamStream?.getTracks().forEach(track => track.stop());
          throw err;
        }
      }

      state.capture = await recordingFrames(mode, () => apiRef.current);
      const firstFrame = await state.capture.frame();
      if (state.cancelled) throw Error("Recording cancelled.");
      state.id = await BeginMP4Recording(doc?.path || "ExBase", microphone);
      await AppendRecordingFrame(state.id, firstFrame);
      if (state.webcamRecorder) state.webcamRecorder.start(100);
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
      if (state.webcamRecorder?.state === "recording") state.webcamRecorder.stop();
      state.webcamStream?.getTracks().forEach(track => track.stop());
      if (state.id) await AbortRecording(state.id).catch(() => {});
      if (current.current === state) current.current = null;
      setRecording({ phase: "idle", mode: null, seconds: 0, webcamEnabled: false });
      const text = String(error);
      onStatus(text); setNotice({ text, error: true });
    } finally { state.initializeDone(); }
  }

  async function clearRecordedVideos() {
    const videos = videosRef.current;
    videosRef.current = null;
    if (videos?.webcam) URL.revokeObjectURL(videos.webcam);
    if (videos?.screen) await ReleasePresentationVideo(videos.screen.token);
    setRecordedVideos({ screen: null, webcam: null });
  }

  callbacks.current = { stop, clearRecordedVideos };
  useEffect(() => EventsOn("recording:close-requested", async () => {
    closing.current = true;
    if (exporting.current) return;
    if (await callbacks.current.stop()) {
      await callbacks.current.clearRecordedVideos();
      Quit();
    } else closing.current = false;
  }), []);
  useEffect(() => () => {
    const state = current.current;
    if (state) {
      state.cancelled = true;
      clearTimeout(state.timer); clearInterval(state.clock);
      state.webcamStream?.getTracks().forEach(track => track.stop());
      if (state.webcamRecorder?.state === "recording") state.webcamRecorder.stop();
      state.capture?.dispose();
      if (state.id) AbortRecording(state.id).catch(() => {});
    }
    const videos = videosRef.current;
    if (videos?.webcam) URL.revokeObjectURL(videos.webcam);
    if (videos?.screen) ReleasePresentationVideo(videos.screen.token);
  }, []);
  return {
    recording, start, stop, notice,
    dismissNotice: () => setNotice(null),
    locked: recording.phase !== "idle" && recording.mode === "canvas-locked",
    recordedVideos, clearRecordedVideos,
    // Run composition first; the save dialog is the last step of Export.
    saveRecording: async (compose) => {
      exporting.current = true;
      let id;
      try {
        if (compose) id = await compose();
        const path = id ? await FinishRecording(id) : await SaveRecordingVideo(videosRef.current.screen.token);
        const text = path ? `Recording saved: ${path}` : "Recording discarded.";
        onStatus(text); setNotice({ text, error: false });
        await clearRecordedVideos();
        return path;
      } catch (error) {
        if (id) await AbortRecording(id).catch(() => {});
        const text = String(error); onStatus(text); setNotice({ text, error: true });
        throw error;
      } finally {
        exporting.current = false;
        if (closing.current) { await clearRecordedVideos(); Quit(); }
      }
    }
  };
}
