import React, { useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { Circle, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { AbortRecording, AppendRecordingFrame, BeginPresentationExport, ChoosePresentationAssets, OpenPresentationAssets, FinishRecording, ReleasePresentationVideo } from "../../wailsjs/go/main/App";
import { EventsOn, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { clampBubble, defaultBubble, drawBubble, presentationFromElements, revealIndex, timeLabel, updatePresentationElements, validatePresentation } from "./presentation";
import { presentationRenderer, seekVideo } from "./render";

export function NarratedReplay({ api, doc, onGenerate, onCancel, onClose }) {
  const capture = () => ({ elements: structuredClone(api.getSceneElements()), files: structuredClone(api.getFiles()), appState: { ...api.getAppState() } });
  const [snapshot, setSnapshot] = useState(capture);
  const plan = useMemo(() => presentationFromElements(snapshot.elements), [snapshot]);
  const [setup, setSetup] = useState(() => !plan || !!plan.needsGeneration);
  const [srtPath, setSRTPath] = useState(plan?.srtPath || "");
  const [videoPath, setVideoPath] = useState(plan?.videoPath || "");
  const [description, setDescription] = useState(plan?.visualDescription || "");
  const [generating, setGenerating] = useState(false), [loading, setLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const problem = useMemo(() => { try { validatePresentation(plan, snapshot.elements); return ""; } catch (error) { return error.message; } }, [plan, snapshot]);
  const renderScene = useMemo(() => problem ? null : presentationRenderer(snapshot, plan), [snapshot, plan, problem]);
  const [bubble, setBubble] = useState(() => clampBubble({ ...defaultBubble, ...plan?.bubble }));
  const offset = Number.isFinite(plan?.offsetMs) ? Math.max(-60000, Math.min(60000, plan.offsetMs)) : 0;
  const [media, setMedia] = useState(null), [duration, setDuration] = useState(0), [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(""), [saved, setSaved] = useState("");
  const dialog = useRef(), stage = useRef(), canvas = useRef(), video = useRef();
  const selected = useRef(null), cancelled = useRef(false), exportID = useRef(null), disposed = useRef(false);
  const assetJob = useRef(0), busy = useRef(false);
  const assetLoader = useRef(null);
  assetLoader.current = loadAssets;
  busy.current = exporting || generating || loading;
  const renderVersion = useRef(0), drag = useRef(null);
  const cues = Array.isArray(plan?.cues) ? plan.cues : [];
  const tooShort = duration > 0 && Math.max(...cues.map((cue) => cue.endMs + offset)) > duration * 1000 + 500;

  useEffect(() => {
    disposed.current = false;
    dialog.current.showModal();
    if (plan?.videoPath) loadAssets(() => OpenPresentationAssets(doc.path, [plan.videoPath]), true);
    return () => { disposed.current = true; cancelled.current = true; assetJob.current++; renderVersion.current++; if (selected.current) ReleasePresentationVideo(selected.current.token).catch(() => {}); };
  }, []);
  useEffect(() => {
    OnFileDrop((x, y, paths) => {
      const bounds = dialog.current?.getBoundingClientRect();
      if (!busy.current && bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) assetLoader.current(() => OpenPresentationAssets(doc.path, paths));
    }, true);
    return () => OnFileDropOff();
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

  function persistOptions(changes = {}) {
    const elements = api.getSceneElementsIncludingDeleted();
    const next = updatePresentationElements(elements, { bubble, offsetMs: offset, srtPath, videoPath, visualDescription: description, ...changes });
    if (next.some((element, i) => element !== elements[i])) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }
  function close() { if (!exporting && !generating && !loading) { video.current?.pause(); persistOptions(); onClose(); } }
  async function loadAssets(load, restoring = false) {
    const job = ++assetJob.current;
    setLoading(true);
    try {
      video.current?.pause();
      const assets = await load();
      if (disposed.current || job !== assetJob.current) { if (assets.video) await ReleasePresentationVideo(assets.video.token); return; }
      const changes = {};
      if (assets.srtPath) {
        changes.srtPath = assets.srtPath;
        setSRTPath(assets.srtPath);
        if (!restoring) {
          changes.needsGeneration = true;
          setSetup(true);
        }
      }
      if (assets.video) {
        const old = selected.current; selected.current = assets.video;
        changes.videoPath = assets.video.path;
        setVideoPath(assets.video.path); setMedia(assets.video); setMediaError(""); setDuration(0); setTime(0);
        if (old) await ReleasePresentationVideo(old.token);
      }
      setError(""); setSaved("");
      if (Object.keys(changes).length) { persistOptions(changes); setSnapshot(capture()); }
    } catch (error) {
      if (!disposed.current && job === assetJob.current) {
        if (restoring) setMediaError("Video not found. Locate the original video to continue.");
        else setError(String(error));
      }
    } finally { if (!disposed.current && job === assetJob.current) setLoading(false); }
  }
  async function generate() {
    if (busy.current || !srtPath || !media || !duration) return;
    video.current?.pause(); setGenerating(true); setError(""); setSaved("");
    try {
      // The user supplies only narration and a visual description. Tool workflow is host-owned.
      const ready = await onGenerate(`Create an editable diagram illustrating this narration.\nSRT file: ${srtPath}\n\nVisual description:\n${description.trim() || "A clear, compact diagram showing the main ideas and their relationships."}`);
      if (disposed.current) return;
      if (!ready) throw Error("Generation cancelled.");
      const generated = presentationFromElements(api.getSceneElements());
      validatePresentation(generated, api.getSceneElements());
      persistOptions({ needsGeneration: false });
      setSnapshot(capture()); setSetup(false); video.current.currentTime = 0;
    } catch (error) { if (!disposed.current) setError(String(error)); }
    finally { if (!disposed.current) setGenerating(false); }
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
    const resize = ((event.clientX - state.x) + (event.clientY - state.y)) / (2 * state.bounds.width);
    setBubble(clampBubble(state.resizing ? { ...state.bubble, size: state.bubble.size + resize } : { ...state.bubble, x: state.bubble.x + dx, y: state.bubble.y + dy }));
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
  const status = error || mediaError || (generating ? "Generating the drawing…" : loading ? "Opening video…" : setup ? "" : problem || (tooShort ? "The video is shorter than the subtitles." : exporting ? `Exporting… ${progress}%` : saved));
  return <dialog ref={dialog} className={`narrated-replay ${setup ? "replay-setup" : ""}`} aria-labelledby="replay-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header className="replay-heading"><strong id="replay-title">Narrated replay</strong><button type="button" className="replay-close" aria-label="Close narrated replay" onClick={close} disabled={exporting || generating || loading}><X strokeWidth={1.5} aria-hidden="true" /></button></header>
    <fieldset className="replay-assets" hidden={!setup} disabled={exporting || generating || loading}>
      <div className="replay-file-row"><strong>Original video</strong><span title={videoPath}>{media?.name || videoPath.split(/[\\/]/).pop() || "No video selected"}{mediaError && <small className="error" role="alert">{mediaError}</small>}</span><button type="button" onClick={() => loadAssets(() => ChoosePresentationAssets(doc.path, "video"))}>{mediaError ? "Locate video" : videoPath ? "Change video" : "Choose video"}</button></div>
      <div className="replay-file-row"><strong>SRT subtitles</strong><span title={srtPath}>{srtPath.split(/[\\/]/).pop() || "No subtitles selected"}</span><button type="button" onClick={() => loadAssets(() => ChoosePresentationAssets(doc.path, "srt"))}>{srtPath ? "Change SRT" : "Choose SRT"}</button></div>
      <div className="replay-drop-zone">Drop a video and an SRT file here</div>
      <label className="replay-description">Visual description <span>Optional</span><textarea rows={3} maxLength={8000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the scene, layout, colors, and ideas to highlight…" /></label>
      {plan?.needsGeneration && <p className="replay-note">Subtitles changed. Generate again to update the drawing and its timing.</p>}
    </fieldset>
    <div className="replay-layout" hidden={setup}>
    <div className="replay-main">
    <div className="replay-stage" ref={stage}>
      <canvas ref={canvas} width="1920" height="1080" aria-label="Progressive drawing preview" />
      <div className={`replay-bubble ${bubble.shape}`} style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: `${bubble.size * 100}%`, visibility: media ? "visible" : "hidden" }} tabIndex={media ? 0 : -1} role="group" aria-label="Face bubble. Drag or use arrow keys to move." onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={bubbleKey}>
        <video ref={video} src={media?.url} preload="auto" playsInline onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (!Number.isFinite(value) || value <= 0) { setError("This video has no valid duration."); return; }
          setDuration(value);
        }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (media) { setDuration(0); setMediaError("Could not open this video. Try an H.264 MP4 video."); } }} />
        {!exporting && <button type="button" className="replay-resize" title="Drag to resize" aria-label="Drag to resize face bubble" onPointerDown={(event) => startDrag(event, true)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} />}
      </div>
    </div>
    <fieldset className="replay-transport" disabled={exporting || loading || !!problem}>
      <button type="button" className="replay-icon-button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={togglePlay} disabled={!duration}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
      <button type="button" className="replay-icon-button" aria-label="Restart" title="Restart" disabled={!duration} onClick={() => { video.current.pause(); video.current.currentTime = 0; }}><RotateCcw aria-hidden="true" /></button>
      <input type="range" aria-label="Playback position" min="0" max={duration || 1} step="0.05" value={time} disabled={!duration} onChange={(event) => { video.current.currentTime = Number(event.target.value); setTime(Number(event.target.value)); }} /><span>{timeLabel(time)} / {timeLabel(duration)}</span>
    </fieldset>
    <div className="replay-caption" aria-live="off">{cue?.text || "\u00a0"}</div>
    <div className="replay-format"><span>1080p</span><span>MP4</span><span>20 fps</span></div>
    </div>
    <div className="replay-sidebar">
      <fieldset className="replay-controls" disabled={exporting || loading || !!problem}>
        <div className="replay-shape"><span>Shape</span><button type="button" className="replay-icon-button" aria-label={bubble.shape === "circle" ? "Switch to rounded square" : "Switch to circle"} title={bubble.shape === "circle" ? "Circle. Click for rounded square" : "Rounded square. Click for circle"} aria-pressed={bubble.shape === "circle"} onClick={() => setBubble((value) => ({ ...value, shape: value.shape === "circle" ? "rounded" : "circle" }))}>{bubble.shape === "circle" ? <Circle aria-hidden="true" /> : <Square aria-hidden="true" />}</button></div>
        <label className="replay-size">Size <input type="range" aria-label="Face bubble size" min="8" max="45" value={Math.round(bubble.size * 100)} onChange={(event) => setBubble((value) => clampBubble({ ...value, size: Number(event.target.value) / 100 }))} /></label>
      </fieldset>
      <div className="replay-export">
        {!media && !loading && <button type="button" onClick={() => loadAssets(() => ChoosePresentationAssets(doc.path, "video"))}>Locate video</button>}
        {exporting ? <button type="button" onClick={() => { cancelled.current = true; }} disabled={progress === 100}>Cancel export</button> : <button type="button" onClick={exportVideo} disabled={!duration || loading || !!problem || tooShort}>Export MP4</button>}
        <div className={`replay-status ${error || mediaError || problem || tooShort ? "error" : ""}`} role={error || mediaError || problem || tooShort ? "alert" : "status"}>{status}</div>
      </div>
    </div>
    </div>
    <footer className="replay-footer" hidden={!setup}><span className={error || mediaError ? "error" : ""} role={error || mediaError ? "alert" : "status"}>{status}</span>{generating ? <button type="button" onClick={onCancel}>Cancel generation</button> : <><button type="button" hidden={!plan || !!problem} disabled={loading} onClick={() => { persistOptions(); setSetup(false); }}>Back to preview</button><button type="button" onClick={generate} disabled={!srtPath || !media || !duration || loading}>{plan ? "Regenerate replay" : "Generate replay"}</button></>}</footer>
  </dialog>;
}
