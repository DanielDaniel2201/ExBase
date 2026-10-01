export function parseScene(text) {
  const scene = JSON.parse(text);
  if (!scene || !Array.isArray(scene.elements)) throw new Error("Not a valid Excalidraw file");
  return scene;
}

export function sceneSignature(elements) {
  return JSON.stringify(elements.map(({ id, version, versionNonce, isDeleted }) => [id, version, versionNonce, !!isDeleted]));
}

// Add one shape (with its bound label) per frame, even when a whole batch arrives.
export function nextPreviewElements(current, target) {
  const wanted = new Map(target.map((element) => [element.id, element]));
  const shown = new Map(current.map((element) => [element.id, element]));
  const kept = current.filter((element) => wanted.has(element.id));
  const next = target.find((element) => !shown.has(element.id)) || target.find((element) =>
    Object.entries(element).some(([key, value]) => !["version", "versionNonce", "updated", "index", "boundElements"].includes(key) && JSON.stringify(value) !== JSON.stringify(shown.get(element.id)?.[key])));
  if (!next) return kept.length !== current.length ? kept : null;
  const group = target.filter((element) => element.id === next.id || element.containerId === next.id);
  const ids = new Set(group.map((element) => element.id));
  return [...kept.filter((element) => !ids.has(element.id)), ...group];
}

// Roll back AI changes while keeping edits the user made during the preview.
export function rebasePreviewEdits(original, shown, current) {
  const before = new Map(shown.map((element) => [element.id, element]));
  const result = new Map(original.map((element) => [element.id, element]));
  for (const element of current) {
    if (!before.has(element.id) || sceneSignature([element]) !== sceneSignature([before.get(element.id)])) result.set(element.id, element);
  }
  return [...result.values()];
}

export function splitMCPElements(elements) {
  if (!Array.isArray(elements)) throw new Error("Invalid MCP canvas");
  const standard = [], shorthand = [], ids = new Set();
  for (const element of elements) {
    if (!element || typeof element !== "object") throw new Error("Invalid MCP element");
    if (["cameraUpdate", "restoreCheckpoint", "delete"].includes(element.type)) continue;
    if (typeof element.id !== "string" || !element.id || ids.has(element.id)) throw new Error("Invalid or duplicate MCP element ID");
    if (![element.x, element.y].every(Number.isFinite)) throw new Error("Invalid MCP element position");
    ids.add(element.id);
    if (Number.isFinite(element.version)) {
      standard.push(element);
    } else if (["arrow", "line"].includes(element.type) && element.points != null) {
      if (!Array.isArray(element.points) || element.points.length < 2 || !element.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) throw new Error("Invalid MCP line points");
      const [dx, dy] = element.points[0];
      shorthand.push({ ...element, x: element.x + dx, y: element.y + dy, points: element.points.map(([x, y]) => [x - dx, y - dy]) });
    } else {
      shorthand.push(element);
    }
  }
  return { standard, shorthand };
}
