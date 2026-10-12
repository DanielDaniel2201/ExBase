import { convertToExcalidrawElements, exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { cameraTrack, fitCamera } from "./camera";

export function presentationRenderer(snapshot, plan) {
  const content = snapshot.elements.filter((element) => !element.isDeleted && !["frame", "magicframe"].includes(element.type));
  const initial = fitCamera(content.length ? getCommonBounds(content) : [0, 0, 1920, 1080]);
  const targets = (plan.camera || []).map((shot) => {
    const ids = new Set(shot.elementIds);
    // Include bound text in focus bounds even when only its shape was selected.
    const focus = ids.size ? content.filter((e) => ids.has(e.id) || ids.has(e.containerId)) : content;
    return { atMs: shot.atMs, viewport: focus.length ? fitCamera(getCommonBounds(focus)) : initial };
  });
  const cameraAt = cameraTrack(initial, targets);
  let cachedKey, cachedCanvas;
  return async (timeMs, offsetMs = 0) => {
    const viewport = cameraAt(timeMs - offsetMs);
    const key = [viewport.x, viewport.y, viewport.width].join(":");
    if (key === cachedKey) return cachedCanvas;
    const scale = 1920 / viewport.width;
    const [frame] = convertToExcalidrawElements([{ type: "frame", id: "exbase-replay-stage", x: viewport.x - viewport.width / 2, y: viewport.y - viewport.width * 9 / 32, width: viewport.width, height: viewport.width * 9 / 16, children: [] }], { regenerateIds: false });
    const shown = content.map((e) => ({ ...e, frameId: frame.id }));
    const canvas = await exportToCanvas({ elements: [frame, ...shown], files: snapshot.files, appState: { ...snapshot.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false }, getDimensions: () => ({ width: 1920, height: 1080, scale }), exportingFrame: frame, exportPadding: 0 });
    cachedKey = key; cachedCanvas = canvas;
    return canvas;
  };
}

export async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.00001 && video.readyState >= 2) return;
  await new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); video.removeEventListener("seeked", onSeek); video.removeEventListener("error", onError); error ? reject(error) : resolve(); };
    const onSeek = () => finish();
    const onError = () => finish(Error("Could not decode this video frame. Try an H.264 MP4 video."));
    const timer = setTimeout(() => finish(Error("Video seeking timed out.")), 15000);
    video.addEventListener("seeked", onSeek, { once: true }); video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}
