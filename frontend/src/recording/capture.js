import { CaptureApplicationFrame } from "../../wailsjs/go/main/App";

// Keep the output canvas alive while Excalidraw remounts on file switches.
export function canvasRecordingFrames(getAPI) {
  const source = document.querySelector(".canvas canvas.static");
  if (!source?.width || !source?.height) throw new Error("Open a canvas before recording.");
  const output = document.createElement("canvas");
  // Stable MP4 dimensions; preserve the source aspect ratio below.
  output.width = 1920; output.height = 1080;
  const context = output.getContext("2d", { alpha: false });
  let pointer = null;
  const trackPointer = (event) => { pointer = event.target.closest?.("canvas.excalidraw__canvas") ? { x: event.clientX, y: event.clientY, down: event.buttons > 0 } : null; };
  const hidePointer = () => { pointer = null; };
  document.addEventListener("pointermove", trackPointer, true);
  document.addEventListener("pointerdown", trackPointer, true);
  document.addEventListener("pointerup", trackPointer, true);
  window.addEventListener("blur", hidePointer);
  const draw = () => {
    const base = document.querySelector(".canvas canvas.static");
    // During a document transition, preserve the last captured frame.
    if (!base?.width || !base?.height) return;
    const ratio = Math.min(output.width / base.width, output.height / base.height);
    const width = base.width * ratio, height = base.height * ratio;
    const x = (output.width - width) / 2, y = (output.height - height) / 2;
    context.fillStyle = getAPI()?.getAppState().viewBackgroundColor || "#fff";
    context.fillRect(0, 0, output.width, output.height);
    context.filter = getComputedStyle(base).filter;
    context.drawImage(base, x, y, width, height);
    const overlay = document.querySelector(".canvas canvas.interactive");
    if (overlay?.width && overlay?.height) { context.filter = getComputedStyle(overlay).filter; context.drawImage(overlay, x, y, width, height); }
    context.filter = "none";
    const bounds = base.getBoundingClientRect();
    const screenScale = width / bounds.width;
    // Text being edited lives in a DOM textarea rather than the static bitmap.
    const editor = document.querySelector(".canvas textarea.excalidraw-wysiwyg");
    if (editor) {
      const style = getComputedStyle(editor);
      const parent = editor.offsetParent.getBoundingClientRect();
      const matrix = new DOMMatrix(style.transform);
      const [originX, originY] = style.transformOrigin.split(" ").map(parseFloat);
      context.save();
      context.beginPath(); context.rect(x, y, width, height); context.clip();
      context.translate(x + (parent.left + parseFloat(style.left) - bounds.left) * screenScale, y + (parent.top + parseFloat(style.top) - bounds.top) * screenScale);
      context.scale(screenScale, screenScale);
      context.translate(originX, originY);
      context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      context.translate(-originX, -originY);
      context.fillStyle = style.color; context.globalAlpha = Number(style.opacity);
      context.filter = style.filter;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.textBaseline = "top"; context.textAlign = style.textAlign;
      const offset = style.textAlign === "center" ? parseFloat(style.width) / 2 : style.textAlign === "right" ? parseFloat(style.width) : 0;
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
      const editingID = getAPI()?.getAppState().editingTextElement?.id;
      const text = getAPI()?.getSceneElements().find((element) => element.id === editingID)?.text ?? editor.value;
      text.split("\n").forEach((line, index) => context.fillText(line, offset, lineHeight * index));
      context.restore();
    }
    if (pointer && pointer.x >= bounds.left && pointer.x < bounds.right && pointer.y >= bounds.top && pointer.y < bounds.bottom) {
      context.beginPath();
      context.arc(x + (pointer.x - bounds.left) * screenScale, y + (pointer.y - bounds.top) * screenScale, pointer.down ? 5 : 3, 0, Math.PI * 2);
      context.fillStyle = pointer.down ? "#5559" : "#5556"; context.fill();
    }
  };
  return { async frame() {
    draw();
    return output.toDataURL("image/png").split(",")[1];
  }, dispose() {
      document.removeEventListener("pointermove", trackPointer, true);
      document.removeEventListener("pointerdown", trackPointer, true);
      document.removeEventListener("pointerup", trackPointer, true);
      window.removeEventListener("blur", hidePointer);
    } };
}

async function applicationRecordingFrames() {
  const readImage = async (data) => {
    const image = new Image(); image.src = data;
    await image.decode(); return image;
  };
  const first = await CaptureApplicationFrame();
  if (!first) throw new Error("Restore the ExBase window before recording.");
  let image = await readImage(first);
  const output = document.createElement("canvas");
  output.width = 1920; output.height = 1080;
  const context = output.getContext("2d", { alpha: false });
  const draw = () => {
    const scale = Math.min(output.width / image.width, output.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.fillStyle = "#f7f7f8"; context.fillRect(0, 0, output.width, output.height);
    context.drawImage(image, (output.width - width) / 2, (output.height - height) / 2, width, height);
  };
  return { async frame() {
      const frame = await CaptureApplicationFrame();
      if (frame) image = await readImage(frame);
      draw();
      return output.toDataURL("image/png").split(",")[1];
  }, dispose() {} };
}

export async function recordingFrames(mode, getAPI) {
  if (mode !== "app") return canvasRecordingFrames(getAPI);
  return applicationRecordingFrames();
}
