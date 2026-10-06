import { convertToExcalidrawElements, exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { revealedElements } from "./presentation";

export function presentationRenderer(snapshot, plan) {
  const content = snapshot.elements.filter((element) => !element.isDeleted && !["frame", "magicframe"].includes(element.type));
  const [left, top, right, bottom] = getCommonBounds(content);
  const scale = Math.min(1920 / Math.max(1, right - left + 80), 1080 / Math.max(1, bottom - top + 80));
  const [frame] = convertToExcalidrawElements([{ type: "frame", id: "exbase-replay-stage", x: (left + right) / 2 - 960 / scale, y: (top + bottom) / 2 - 540 / scale, width: 1920 / scale, height: 1080 / scale, children: [] }], { regenerateIds: false });
  let cachedIndex = -1, cachedCanvas;
  return async (index) => {
    if (index === cachedIndex) return cachedCanvas;
    const shown = revealedElements(snapshot.elements, plan, index).filter((e) => !["frame", "magicframe"].includes(e.type)).map((e) => ({ ...e, frameId: frame.id }));
    const canvas = await exportToCanvas({ elements: [frame, ...shown], files: snapshot.files, appState: { ...snapshot.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false, exportScale: scale }, exportingFrame: frame, exportPadding: 0 });
    cachedIndex = index; cachedCanvas = canvas;
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
