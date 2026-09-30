export function parseScene(text) {
  const scene = JSON.parse(text);
  if (!scene || !Array.isArray(scene.elements)) throw new Error("Not a valid Excalidraw file");
  return scene;
}

export function sceneSignature(elements) {
  return JSON.stringify(elements.map(({ id, version, versionNonce, isDeleted }) => [id, version, versionNonce, !!isDeleted]));
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
