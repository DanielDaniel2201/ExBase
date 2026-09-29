export function parseScene(text) {
  const scene = JSON.parse(text);
  if (!scene || !Array.isArray(scene.elements)) throw new Error("Not a valid Excalidraw file");
  return scene;
}
