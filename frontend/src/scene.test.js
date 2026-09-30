import assert from "node:assert/strict";
import test from "node:test";
import { parseScene, sceneSignature, splitMCPElements } from "./scene.js";

test("accepts Excalidraw data and rejects unrelated JSON", () => {
  assert.deepEqual(parseScene('{"elements":[],"appState":{},"files":{}}').elements, []);
  assert.throws(() => parseScene("{}"), /valid Excalidraw/);
});

test("MCP results retain standard elements, separate shorthand, and reject duplicate IDs", () => {
  const original = { id: "a", type: "rectangle", x: 0, y: 0, version: 1, versionNonce: 3 };
  const added = { id: "b", type: "rectangle", x: 20, y: 20, label: { text: "New" } };
  assert.deepEqual(splitMCPElements([original, { type: "cameraUpdate" }, added]), { standard: [original], shorthand: [added] });
  assert.throws(() => splitMCPElements([original, original]), /duplicate/);
  assert.throws(() => splitMCPElements([{ id: "bad", x: "NaN", y: 0 }]), /position/);
  assert.notEqual(sceneSignature([original]), sceneSignature([{ ...original, version: 2 }]));
  assert.notEqual(sceneSignature([original]), sceneSignature([{ ...original, isDeleted: true }]));
});
