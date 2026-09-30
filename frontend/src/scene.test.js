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

test("MCP line normalization preserves absolute points before skeleton conversion", () => {
  for (const type of ["arrow", "line"]) {
    for (const points of [[[0, 40], [138, 0]], [[0, 0], [138, -40]], [[10, 20], [60, 20], [138, 80]]]) {
      const original = { id: "edge", type, x: 126, y: 210, points };
      const snapshot = structuredClone(original);
      const { shorthand: [normalized] } = splitMCPElements([original]);
      assert.deepEqual(normalized.points[0], [0, 0]);
      assert.deepEqual(normalized.points.map(([x, y]) => [normalized.x + x, normalized.y + y]), points.map(([x, y]) => [original.x + x, original.y + y]));
      assert.deepEqual(original, snapshot);
      assert.deepEqual(splitMCPElements([normalized]).shorthand, [normalized]);
      assert.deepEqual(splitMCPElements([{ ...original, version: 1 }]).standard, [{ ...original, version: 1 }]);
    }
  }
  for (const points of [[], [[0, 0]], [[0, 0], [1, NaN]], "invalid"]) {
    assert.throws(() => splitMCPElements([{ id: "bad", type: "arrow", x: 0, y: 0, points }]), /line points/);
  }
});
