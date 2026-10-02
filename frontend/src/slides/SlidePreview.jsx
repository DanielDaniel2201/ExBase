import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, exportToBlob } from "@excalidraw/excalidraw";
import { ExportSlides } from "../../wailsjs/go/main/App";
import { frameElements, orderedFrameElements, slideFrames } from "./slides";
import { blobBase64, prepareSlideExport, slidesPPT, slidesHTMLBase64 } from "./slide-export";

export function SlidePreview({ api, doc, onClose }) {
  const [snapshot] = useState(() => ({ elements: structuredClone(api.getSceneElements()), files: structuredClone(api.getFiles()), appState: { ...api.getAppState() } }));
  const [frames, setFrames] = useState(() => slideFrames(snapshot.elements));
  const [current, setCurrent] = useState(frames[0]?.id);
  const [images, setImages] = useState({});
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState("");
  const root = useRef();
  const index = frames.findIndex((frame) => frame.id === current);
  const ready = frames.length > 0 && frames.every((frame) => images[frame.id]);

  useEffect(() => {
    root.current.focus();
    let active = true;
    (async () => {
      for (const frame of slideFrames(snapshot.elements)) {
        const blob = await exportToBlob({
          elements: frameElements(snapshot.elements, frame), files: snapshot.files,
          appState: { ...snapshot.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false, exportScale: 1920 / Math.max(frame.width, frame.height) },
          exportingFrame: frame, exportPadding: 0, maxWidthOrHeight: 1920, mimeType: "image/png",
        });
        const dataURL = await blobBase64(blob);
        if (!active) return;
        setImages((previous) => ({ ...previous, [frame.id]: dataURL }));
      }
    })().catch((error) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [snapshot]);

  function navigate(step) { setCurrent(frames[Math.max(0, Math.min(frames.length - 1, index + step))]?.id); }

  function reorder(id, target) {
    const source = frames.findIndex((frame) => frame.id === id);
    if (source < 0 || source === target || target < 0 || target >= frames.length) return;
    const next = [...frames]; next.splice(target, 0, next.splice(source, 1)[0]);
    api.updateScene({ elements: orderedFrameElements(api.getSceneElementsIncludingDeleted(), next.map((frame) => frame.id)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setFrames(next);
  }

  async function exportSlides(format) {
    if (!ready || exporting) return;
    setExporting(true); setError(""); setExported("");
    try {
      const slides = await prepareSlideExport(frames, snapshot, format);
      const data = format === "pptx" ? await slidesPPT(slides, doc.path.split(/[\\/]/).pop()) : await slidesHTMLBase64(slides, doc.path.split(/[\\/]/).pop());
      const path = await ExportSlides(doc.path, format, data);
      if (path) setExported(`Exported: ${path}`);
    } catch (error) { setError(String(error)); }
    finally { setExporting(false); }
  }

  return <section ref={root} tabIndex={-1} className="slide-preview" aria-label="Slide preview" onKeyDown={(event) => {
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) { event.preventDefault(); navigate(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); navigate(-1); }
    else if (event.key === "Home") { event.preventDefault(); setCurrent(frames[0]?.id); }
    else if (event.key === "End") { event.preventDefault(); setCurrent(frames.at(-1)?.id); }
    else if (event.key === "Escape" && !exporting) onClose();
  }}>
    <header className="slide-preview-heading"><button type="button" onClick={onClose} disabled={exporting}>← Back to canvas</button><span>Slides</span><div className="slide-export-actions"><button type="button" disabled={!ready || exporting} onClick={() => exportSlides("pptx")}>Export as PPT</button><button type="button" disabled={!ready || exporting} onClick={() => exportSlides("html")}>Export as HTML</button></div></header>
    <nav className="slide-thumbnails" aria-label="Slides">
      {frames.map((frame, i) => <button type="button" key={frame.id} draggable className={`slide-thumbnail ${frame.id === current ? "active" : ""}`} aria-label={`Slide ${i + 1}: ${frame.name || "Untitled"}`} aria-current={frame.id === current ? "page" : undefined} title="Drag to reorder, or use Alt + ↑ / ↓" onClick={() => setCurrent(frame.id)} onDragStart={(event) => { event.dataTransfer.setData("text/plain", frame.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); reorder(event.dataTransfer.getData("text/plain"), i); }} onKeyDown={(event) => {
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); reorder(frame.id, i + (event.key === "ArrowUp" ? -1 : 1)); }
      }}>
        <span className="slide-thumbnail-image">{images[frame.id] ? <img src={images[frame.id]} alt="" draggable={false} /> : <span>Loading…</span>}</span>
        <span className="slide-thumbnail-label">{i + 1}. {frame.name || "Untitled"}</span>
      </button>)}
    </nav>
    <div className="slide-stage">{images[current] ? <img className="slide-image" src={images[current]} alt={frames[index]?.name || `Slide ${index + 1}`} draggable={false} /> : <p role="status">{frames.length ? "Preparing slides…" : "No slides available."}</p>}</div>
    <footer className="slide-preview-footer"><button type="button" aria-label="Previous slide" disabled={index <= 0} onClick={() => navigate(-1)}>←</button><span aria-live="polite">{index + 1} / {frames.length}</span><button type="button" aria-label="Next slide" disabled={index >= frames.length - 1} onClick={() => navigate(1)}>→</button><span className={error ? "error slide-export-status" : "slide-export-status"} role={error ? "alert" : "status"}>{error || (exporting ? "Exporting…" : exported)}</span></footer>
  </section>;
}
