export function presentationFromElements(elements) {
  return elements.find((element) => !element.isDeleted && element.customData?.exbasePresentation)?.customData.exbasePresentation || null;
}

export function updatePresentationElements(elements, changes) {
  return elements.map((element) => {
    const metadata = element.customData?.exbasePresentation;
    if (!metadata || element.isDeleted) return element;
    const next = { ...metadata, ...changes };
    if (JSON.stringify(next) === JSON.stringify(metadata)) return element;
    return { ...element, customData: { ...element.customData, exbasePresentation: next }, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() };
  });
}

export function validatePresentation(plan, elements) {
  if (plan?.needsGeneration) throw Error("Subtitles changed. Generate the narrated replay again.");
  if (![1, 2].includes(plan?.version) || !plan.srtPath || !Array.isArray(plan.cues) || !plan.cues.length) throw Error("This canvas has an invalid narration timeline. Generate it again from SRT.");
  for (let i = 0; i < plan.cues.length; i++) {
    const cue = plan.cues[i];
    if (cue.id !== i + 1 || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs || typeof cue.text !== "string" || (i > 0 && cue.startMs < plan.cues[i - 1].startMs)) throw Error("This canvas has invalid subtitles. Generate the timeline again.");
  }
  if (!Array.isArray(plan.camera) || !plan.camera.length) throw Error("Generate Pan / Zoom again for this canvas.");
  const drawable = new Set(elements.filter((e) => !e.isDeleted && !["frame", "magicframe"].includes(e.type)).map((e) => e.id));
  let lastCue = 0, lastTime = -1;
  for (const shot of plan.camera) {
    const cue = plan.cues.find((cue) => cue.id === shot.cueId);
    if (!cue || shot.cueId <= lastCue || !Number.isFinite(shot.atMs) || shot.atMs < cue.startMs || shot.atMs >= cue.endMs || shot.atMs <= lastTime || !Array.isArray(shot.elementIds) || new Set(shot.elementIds).size !== shot.elementIds.length) throw Error("Invalid camera group. Generate Pan / Zoom again.");
    for (const id of shot.elementIds) if (!drawable.has(id)) throw Error("A camera target is missing. Generate Pan / Zoom again.");
    lastCue = shot.cueId; lastTime = shot.atMs;
  }
  return plan;
}

export const defaultBubble = { x: 0.78, y: 0.04, size: 0.18, shape: "rounded" };
export function clampBubble(bubble) {
  const size = Math.max(0.08, Math.min(0.45, Number.isFinite(bubble.size) ? bubble.size : defaultBubble.size));
  return { size, shape: bubble.shape === "circle" ? "circle" : "rounded", x: Math.max(0, Math.min(1 - size, Number.isFinite(bubble.x) ? bubble.x : defaultBubble.x)), y: Math.max(0, Math.min(1 - size * 16 / 9, Number.isFinite(bubble.y) ? bubble.y : defaultBubble.y)) };
}

export function drawBubble(context, video, bubble) {
  const x = bubble.x * 1920, y = bubble.y * 1080, size = bubble.size * 1920;
  const crop = Math.min(video.videoWidth, video.videoHeight);
  if (!crop) return;
  context.save(); context.beginPath();
  context.roundRect(x, y, size, size, bubble.shape === "circle" ? size / 2 : size * 0.14);
  context.clip();
  context.drawImage(video, (video.videoWidth - crop) / 2, (video.videoHeight - crop) / 2, crop, crop, x, y, size, size);
  context.restore();
}

export function timeLabel(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
