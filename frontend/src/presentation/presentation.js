export function presentationFromElements(elements) {
  return elements.find((element) => !element.isDeleted && element.customData?.exbasePresentation)?.customData.exbasePresentation || null;
}

export function validatePresentation(plan, elements) {
  if (plan?.version !== 1 || !plan.srtPath || !Array.isArray(plan.cues) || !plan.cues.length || !Array.isArray(plan.steps) || !plan.steps.length || !Array.isArray(plan.baseIds)) throw Error("This canvas has an invalid narration timeline. Generate it again from SRT.");
  const ids = new Set(elements.filter((e) => !e.isDeleted).map((e) => e.id));
  for (const cue of plan.cues) if (!Number.isInteger(cue.id) || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs || typeof cue.text !== "string") throw Error("This canvas has invalid subtitles. Generate the timeline again.");
  const covered = new Set(plan.baseIds);
  let previous = -1;
  for (const step of plan.steps) {
    if (!Number.isFinite(step.atMs) || step.atMs < previous || !Array.isArray(step.elementIds) || !step.elementIds.length || !plan.cues.some((cue) => cue.id === step.cueId)) throw Error("This canvas has an invalid reveal group. Generate the timeline again.");
    for (const id of step.elementIds) { if (!ids.has(id) || covered.has(id)) throw Error("The drawing changed and a timed element is missing or repeated. Generate the timeline again."); covered.add(id); }
    previous = step.atMs;
  }
  for (const id of plan.baseIds) if (!ids.has(id)) throw Error("A baseline element is missing. Generate the timeline again.");
  if ([...ids].some((id) => !covered.has(id))) throw Error("The drawing has new elements without reveal times. Generate the timeline again.");
  return plan;
}

export function revealIndex(plan, timeMs, offsetMs = 0) {
  let index = 0;
  while (index < plan.steps.length && plan.steps[index].atMs + offsetMs <= timeMs) index++;
  return index;
}

export function revealedElements(elements, plan, index) {
  const ids = new Set(plan.baseIds);
  for (const step of plan.steps.slice(0, index)) for (const id of step.elementIds) ids.add(id);
  return elements.filter((e) => !e.isDeleted && ids.has(e.id)).map((e) => ({ ...e, boundElements: e.boundElements?.filter((bound) => ids.has(bound.id)) || null }));
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
