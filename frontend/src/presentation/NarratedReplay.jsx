import React, { useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { AbortRecording, AppendRecordingFrame, BeginPresentationExport, ChoosePresentationVideo, FinishRecording, ReleasePresentationVideo } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { clampBubble, defaultBubble, drawBubble, presentationFromElements, revealIndex, timeLabel, validatePresentation } from "./presentation";
import { presentationRenderer, seekVideo } from "./render";

export function NarratedReplay({ api, doc, onClose }) {
  const [snapshot] = useState(() => ({ elements: structuredClone(api.getSceneElements()), files: structuredClone(api.getFiles()), appState: { ...api.getAppState() } }));
  const plan = useMemo(() => presentationFromElements(snapshot.elements), [snapshot]);
  const problem = useMemo(() => { try { validatePresentation(plan, snapshot.elements); return ""; } catch (error) { return error.message; } }, [plan, snapshot]);
  const renderScene = useMemo(() => problem ? null : presentationRenderer(snapshot, plan), [snapshot, plan, problem]);
  const [bubble, setBubble] = useState(() => clampBubble({ ...defaultBubble, ...plan?.bubble }));
  const [offset, setOffset] = useState(Number.isFinite(plan?.offsetMs) ? Math.max(-60000, Math.min(60000, plan.offsetMs)) : 0);
  const [media, setMedia] = useState(null), [duration, setDuration] = useState(0), [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(""), [saved, setSaved] = useState("");
  const dialog = useRef(), stage = useRef(), canvas = useRef(), video = useRef();
  const selected = useRef(null), cancelled = useRef(false), exportID = useRef(null), disposed = useRef(false);
  const renderVersion = useRef(0), drag = useRef(null);
  const cues = Array.isArray(plan?.cues) ? plan.cues : [];
  const tooShort = duration > 0 && Math.max(...cues.map((cue) => cue.endMs + offset)) > duration * 1000 + 500;

  useEffect(() => {
    disposed.current = false;
    dialog.current.showModal();
    return () => { disposed.current = true; cancelled.current = true; renderVersion.current++; if (selected.current) ReleasePresentationVideo(selected.current.token).catch(() => {}); };
  }, []);
  useEffect(() => EventsOn("recording:close-requested", () => {
    if (exportID.current) { cancelled.current = true; setError("Export cancelled. Wait for it to stop before closing the window."); }
  }), []);
  useEffect(() => {
    if (!renderScene) return;
    let active = true, animation, previous = -1, clock = 0;
    const tick = (now) => {
      if (!active) return;
      const seconds = video.current?.currentTime || 0, index = revealIndex(plan, seconds * 1000, offset);
      if (index !== previous) {
        previous = index;
        const version = ++renderVersion.current;
        renderScene(index).then((image) => {
          if (!active || version !== renderVersion.current || disposed.current) return;
          const context = canvas.current.getContext("2d"); context.clearRect(0, 0, 1920, 1080); context.drawImage(image, 0, 0, 1920, 1080);
        }).catch((error) => { if (active) setError(String(error)); });
      }
      if (now - clock > 100) { clock = now; setTime(seconds); }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(animation); renderVersion.current++; };
  }, [renderScene, plan, offset]);

  function persistOptions() {
    const elements = api.getSceneElementsIncludingDeleted();
    const next = elements.map((element) => {
      const metadata = element.customData?.exbasePresentation;
      if (!metadata || element.isDeleted || JSON.stringify(metadata.bubble) === JSON.stringify(bubble) && (metadata.offsetMs || 0) === offset) return element;
      return { ...element, customData: { ...element.customData, exbasePresentation: { ...metadata, bubble, offsetMs: offset } }, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() };
    });
    if (next.some((element, i) => element !== elements[i])) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }
  function close() { if (!exporting) { video.current?.pause(); persistOptions(); onClose(); } }
  async function chooseVideo() {
    try {
      video.current?.pause();
      const next = await ChoosePresentationVideo(); if (!next.token) return;
      if (disposed.current) { await ReleasePresentationVideo(next.token); return; }
      const old = selected.current; selected.current = next;
      setMedia(next); setDuration(0); setTime(0); setError(""); setSaved("");
      if (old) await ReleasePresentationVideo(old.token);
    } catch (error) { if (!disposed.current) setError(String(error)); }
  }
  function startDrag(event, resizing = false) {
    if (exporting || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { x: event.clientX, y: event.clientY, bounds: stage.current.getBoundingClientRect(), bubble, resizing };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    const state = drag.current; if (!state) return;
    const dx = (event.clientX - state.x) / state.bounds.width, dy = (event.clientY - state.y) / state.bounds.height;
    setBubble(clampBubble(state.resizing ? { ...state.bubble, size: state.bubble.size + dx } : { ...state.bubble, x: state.bubble.x + dx, y: state.bubble.y + dy }));
  }
  function bubbleKey(event) {
    if (exporting || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 0.02 : 0.005;
    setBubble((value) => clampBubble({ ...value, x: value.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), y: value.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) }));
  }
  async function togglePlay() {
    try { if (video.current.paused) { if (video.current.ended) video.current.currentTime = 0; await video.current.play(); } else video.current.pause(); } catch (error) { setError(String(error)); }
  }
  async function exportVideo() {
    if (!media || !duration || problem || tooShort || exporting) return;
    persistOptions(); setExporting(true); setProgress(0); setError(""); setSaved(""); cancelled.current = false;
    const source = video.current, previousTime = source.currentTime; source.pause();
    try {
      exportID.current = await BeginPresentationExport(doc.path, media.token);
      const output = document.createElement("canvas"); output.width = 1920; output.height = 1080;
      const context = output.getContext("2d", { alpha: false }), frames = Math.ceil(duration * 20);
      for (let frame = 0; frame < frames; frame++) {
        if (cancelled.current) throw Error("Export cancelled.");
        const seconds = frame / 20; await seekVideo(source, seconds);
        const drawing = await renderScene(revealIndex(plan, seconds * 1000, offset));
        if (cancelled.current) throw Error("Export cancelled.");
        context.fillStyle = snapshot.appState.viewBackgroundColor || "#fff"; context.fillRect(0, 0, 1920, 1080);
        context.drawImage(drawing, 0, 0, 1920, 1080); drawBubble(context, source, bubble);
        await AppendRecordingFrame(exportID.current, output.toDataURL("image/png").split(",")[1]);
        if (frame % 10 === 0) setProgress(Math.round((frame + 1) / frames * 100));
      }
      if (cancelled.current) throw Error("Export cancelled.");
      setProgress(100); const path = await FinishRecording(exportID.current); exportID.current = null;
      setSaved(path ? `Exported: ${path}` : "Export discarded.");
    } catch (error) {
      if (exportID.current) await AbortRecording(exportID.current).catch(() => {});
      exportID.current = null; if (!disposed.current) setError(String(error));
    } finally { if (!disposed.current) { await seekVideo(source, previousTime).catch(() => {}); setExporting(false); } }
  }

  const cue = cues.find((cue) => time * 1000 >= cue.startMs + offset && time * 1000 < cue.endMs + offset);
  const endDrag = () => { drag.current = null; };
  return <dialog ref={dialog} className="narrated-replay" aria-labelledby="replay-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="replay-heading"><strong id="replay-title">Narrated replay</strong><span title={plan?.srtPath}>{plan?.srtPath?.split(/[\\/]/).pop()}</span><button type="button" onClick={close} disabled={exporting}>Back to canvas</button></header>
    <div className="replay-stage" ref={stage}>
      <canvas ref={canvas} width="1920" height="1080" aria-label="Progressive drawing preview" />
      <div className={`replay-bubble ${bubble.shape}`} style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: `${bubble.size * 100}%`, visibility: media ? "visible" : "hidden" }} tabIndex={media ? 0 : -1} role="group" aria-label="Face bubble. Drag or use arrow keys to move." onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={bubbleKey}>
        <video ref={video} src={media?.url} preload="auto" playsInline onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (!Number.isFinite(value) || value <= 0) { setError("This video has no valid duration."); return; }
          setDuration(value);
        }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (media) { setDuration(0); setError("Could not open this video. Try an H.264 MP4 video."); } }} />
        {!exporting && <button type="button" className="replay-resize" aria-label="Drag to resize face bubble" onPointerDown={(event) => startDrag(event, true)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>↘</button>}
      </div>
    </div>
    <fieldset className="replay-controls" disabled={exporting || !!problem}>
      <div className="replay-options"><button type="button" onClick={chooseVideo}>{media ? "Change video" : "Choose video"}</button><span className="replay-video-name" title={media?.name}>{media?.name || "Choose the video matching this SRT"}</span><label>Shape <select value={bubble.shape} onChange={(event) => setBubble((value) => ({ ...value, shape: event.target.value }))}><option value="rounded">Rounded square</option><option value="circle">Circle</option></select></label><label>Size <input type="range" aria-label="Face bubble size" min="8" max="45" value={Math.round(bubble.size * 100)} onChange={(event) => setBubble((value) => clampBubble({ ...value, size: Number(event.target.value) / 100 }))} /></label><label>Timing offset (s) <input type="number" min="-60" max="60" step="0.1" value={offset / 1000} onChange={(event) => setOffset(Math.round(Math.max(-60, Math.min(60, Number(event.target.value))) * 1000))} /></label></div>
      <div className="replay-transport"><button type="button" onClick={togglePlay} disabled={!duration}>{playing ? "Pause" : "Play"}</button><button type="button" disabled={!duration} onClick={() => { video.current.pause(); video.current.currentTime = 0; }}>Restart</button><input type="range" aria-label="Playback position" min="0" max={duration || 1} step="0.05" value={time} disabled={!duration} onChange={(event) => { video.current.currentTime = Number(event.target.value); setTime(Number(event.target.value)); }} /><span>{timeLabel(time)} / {timeLabel(duration)}</span></div>
    </fieldset>
    <div className="replay-caption" aria-live="off">{cue?.text || "\u00a0"}</div>
    <footer className="replay-footer"><span className={problem || error || tooShort ? "error" : ""} role={problem || error || tooShort ? "alert" : "status"}>{problem || error || (tooShort ? "The video is shorter than the SRT. Choose the matching video or adjust the timing offset." : exporting ? `Exporting… ${progress}%` : saved || "1080p MP4 · 20 fps · original video audio")}</span>{exporting ? <button type="button" onClick={() => { cancelled.current = true; }} disabled={progress === 100}>Cancel export</button> : <button type="button" onClick={exportVideo} disabled={!duration || !!problem || tooShort}>Export MP4</button>}</footer>
  </dialog>;
}
