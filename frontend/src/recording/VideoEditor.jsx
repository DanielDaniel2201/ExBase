import React, { useRef, useState, useEffect } from "react";
import { Circle, Square, Play, Pause, RotateCcw, Download, X } from "lucide-react";
import { AbortRecording, AppendRecordingFrame, BeginPresentationExport } from "../../wailsjs/go/main/App";
import { seekVideo } from "../presentation/render";
import { drawBubble } from "../presentation/presentation";

export function VideoEditor({ screenRecording, webcamRecording, document: recordingDocument, onClose, onExport }) {
  const canvasRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [bubbleConfig, setBubbleConfig] = useState({ x: 50, y: 50, size: 180, shape: "circle", enabled: !!webcamRecording });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    let active = true;
    const screen = screenVideoRef.current, webcam = webcamVideoRef.current;
    const cleanups = [];
    const load = (video, url, label) => new Promise((resolve, reject) => {
      const finish = (error) => { cleanup(); error ? reject(error) : resolve(); };
      const loaded = () => finish();
      const failed = () => finish(Error(`Could not load ${label}.`));
      const timer = setTimeout(() => finish(Error(`Loading ${label} timed out. Close the editor and try again.`)), 15000);
      const cleanup = () => { clearTimeout(timer); video.removeEventListener("loadeddata", loaded); video.removeEventListener("error", failed); };
      cleanups.push(cleanup);
      video.addEventListener("loadeddata", loaded, { once: true });
      video.addEventListener("error", failed, { once: true });
      video.src = url; video.load();
    });
    setLoading(true); setLoadError(null);
    Promise.all([load(screen, screenRecording.url, "screen recording"), ...(webcamRecording ? [load(webcam, webcamRecording, "webcam recording")] : [])]).then(() => {
      if (!active) return;
      if (!Number.isFinite(screen.duration) || screen.duration <= 0) throw Error("Recording has an invalid duration.");
      setDuration(screen.duration); setLoading(false);
    }).catch((error) => { if (active) { setLoadError(String(error)); setLoading(false); } });
    return () => {
      active = false; cleanups.forEach((cleanup) => cleanup());
      for (const video of [screen, webcam]) { video.pause(); video.removeAttribute("src"); video.load(); }
    };
  }, [screenRecording.url, webcamRecording]);

  function renderFrame() {
    const canvas = canvasRef.current, screen = screenVideoRef.current, webcam = webcamVideoRef.current;
    if (!canvas || screen.readyState < 2) return;
    if (canvas.width !== screen.videoWidth || canvas.height !== screen.videoHeight) { canvas.width = screen.videoWidth; canvas.height = screen.videoHeight; }
    const ctx = canvas.getContext("2d");
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
    if (bubbleConfig.enabled && webcamRecording && webcam.readyState >= 2) {
      ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
      drawBubble(ctx, webcam, { x: (canvas.width - bubbleConfig.x - bubbleConfig.size) / 1920, y: bubbleConfig.y / 1080, size: bubbleConfig.size / 1920, shape: bubbleConfig.shape });
      ctx.restore();
    }
  }

  useEffect(() => {
    if (loading || exporting) return;
    let animation;
    let active = true;
    const screen = screenVideoRef.current, webcam = webcamVideoRef.current;
    const draw = () => { renderFrame(); setCurrentTime(screen.currentTime); if (playing && active) { cancelAnimationFrame(animation); animation = requestAnimationFrame(draw); } };
    const ended = () => setPlaying(false);
    const play = async () => {
      try { await screen.play(); if (webcamRecording && active) await webcam.play();
        if (!active) { screen.pause(); webcam.pause(); } }
      catch (error) { if (active) { setLoadError(String(error)); setPlaying(false); } }
    };
    screen.addEventListener("ended", ended);
    screen.addEventListener("seeked", draw); webcam.addEventListener("seeked", draw);
    if (playing) play(); else { screen.pause(); webcam.pause(); }
    draw();
    return () => { active = false; cancelAnimationFrame(animation); screen.removeEventListener("ended", ended); screen.removeEventListener("seeked", draw); webcam.removeEventListener("seeked", draw); screen.pause(); webcam.pause(); };
  }, [loading, playing, bubbleConfig, exporting, webcamRecording]);

  // Handle drag
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Check if clicking on bubble
    if (
      x >= bubbleConfig.x &&
      x <= bubbleConfig.x + bubbleConfig.size &&
      y >= bubbleConfig.y &&
      y <= bubbleConfig.y + bubbleConfig.size
    ) {
      setIsDragging(true);
      setDragOffset({
        x: x - bubbleConfig.x,
        y: y - bubbleConfig.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const newX = Math.max(0, Math.min(x - dragOffset.x, canvas.width - bubbleConfig.size));
    const newY = Math.max(0, Math.min(y - dragOffset.y, canvas.height - bubbleConfig.size));

    setBubbleConfig(prev => ({ ...prev, x: newX, y: newY }));
    renderFrame();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Reset to beginning
  const handleReset = () => {
    if (screenVideoRef.current) {
      screenVideoRef.current.currentTime = 0;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.currentTime = 0;
    }
    setCurrentTime(0);
    setPlaying(false);
  };

  async function handleExport() {
    setPlaying(false); setExporting(true); setLoadError(null);
    let id;
    try {
      await onExport(webcamRecording && bubbleConfig.enabled ? async () => {
        id = await BeginPresentationExport(recordingDocument, screenRecording.token);
        const screen = screenVideoRef.current, webcam = webcamVideoRef.current;
        screen.muted = true;
        try {
          const frames = Math.ceil(duration * 20);
          for (let frame = 0; frame < frames; frame++) {
            const time = frame / 20;
            await seekVideo(screen, Math.min(time, duration - 0.001));
            await seekVideo(webcam, Number.isFinite(webcam.duration) ? Math.min(time, Math.max(0, webcam.duration - 0.001)) : time);
            renderFrame();
            await AppendRecordingFrame(id, canvasRef.current.toDataURL("image/png").split(",")[1]);
            setExportProgress(Math.round((frame + 1) / frames * 100));
          }
          return id;
        } catch (error) {
          await AbortRecording(id).catch(() => {});
          throw error;
        } finally { screen.muted = false; }
      } : null);
    } catch (error) { setLoadError(String(error)); }
    finally { setExporting(false); setExportProgress(0); }
  }

  return (
    <div className="video-editor-overlay">
      <div className="video-editor">
        <header className="video-editor-header">
          <h2>Edit Recording</h2>
          <button
            type="button"
            className="video-editor-close"
            onClick={onClose}
            disabled={exporting}
            aria-label="Close editor"
          >
            <X size={20} />
          </button>
        </header>

        <video ref={screenVideoRef} muted={false} preload="auto" playsInline style={{ display: "none" }} />
        <video ref={webcamVideoRef} preload="auto" playsInline muted style={{ display: "none" }} />
        {loading && (
          <div className="video-editor-loading">
            <p>Loading recording...</p>
          </div>
        )}

        {loadError && (
          <div className="video-editor-error">
            <p>Error: {loadError}</p>
            <button onClick={onClose}>Close</button>
          </div>
        )}

        {!loading && (
          <div className="video-editor-content">
          <div className="video-editor-preview">
            <canvas
              ref={canvasRef}
              className="video-editor-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>

          <fieldset className="video-editor-sidebar" disabled={exporting || !duration}>
            <div className="video-editor-section">
              <h3>Webcam Bubble</h3>
              <label className="video-editor-toggle">
                <input
                  type="checkbox"
                  disabled={!webcamRecording}
                  checked={bubbleConfig.enabled}
                  onChange={(e) => {
                    setBubbleConfig(prev => ({ ...prev, enabled: e.target.checked }));
                    renderFrame();
                  }}
                />
                <span>Show webcam</span>
              </label>

              {webcamRecording && bubbleConfig.enabled && (
                <>
                  <label className="video-editor-label">Shape</label>
                  <div className="video-editor-shape-options">
                    <button
                      className={bubbleConfig.shape === "circle" ? "active" : ""}
                      onClick={() => {
                        setBubbleConfig(prev => ({ ...prev, shape: "circle" }));
                        renderFrame();
                      }}
                    >
                      <Circle size={20} />
                      Circle
                    </button>
                    <button
                      className={bubbleConfig.shape === "rounded" ? "active" : ""}
                      onClick={() => {
                        setBubbleConfig(prev => ({ ...prev, shape: "rounded" }));
                        renderFrame();
                      }}
                    >
                      <Square size={20} />
                      Rounded
                    </button>
                  </div>

                  <label className="video-editor-label">
                    Size: {bubbleConfig.size}px
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="400"
                    value={bubbleConfig.size}
                    onChange={(e) => {
                      setBubbleConfig(prev => ({ ...prev, size: parseInt(e.target.value) }));
                      renderFrame();
                    }}
                  />
                </>
              )}
            </div>

            <div className="video-editor-controls">
              <button
                onClick={() => setPlaying(!playing)}
                className="video-editor-play"
              >
                {playing ? <Pause size={20} /> : <Play size={20} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button onClick={handleReset}>
                <RotateCcw size={16} />
                Reset
              </button>
            </div>

            <div className="video-editor-timeline">
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={currentTime}
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  if (screenVideoRef.current) screenVideoRef.current.currentTime = time;
                  if (webcamRecording && webcamVideoRef.current) webcamVideoRef.current.currentTime = time;
                  setCurrentTime(time);
                  renderFrame();
                }}
              />
              <span>{formatTime(duration)}</span>
            </div>

            <button
              className="video-editor-export"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download size={16} />
              {exporting ? `Exporting ${exportProgress}%...` : "Export Video"}
            </button>
          </fieldset>
        </div>
        )}
      </div>
    </div>
  );
}
