import assert from "node:assert/strict";
import test from "node:test";
import { parseScene } from "./scene.js";

test("accepts Excalidraw data and rejects unrelated JSON", () => {
  assert.deepEqual(parseScene('{"elements":[],"appState":{},"files":{}}').elements, []);
  assert.throws(() => parseScene("{}"), /valid Excalidraw/);
});
