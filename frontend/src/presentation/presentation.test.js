import assert from "node:assert/strict";
import test from "node:test";
import { clampBubble, presentationFromElements, revealIndex, revealedElements, updatePresentationElements, validatePresentation } from "./presentation.js";

test("narration replay reconstructs seeks, offsets and bound label visibility without mutating the scene", () => {
  const elements = [{ id: "existing" }, { id: "node", boundElements: [{ id: "text" }, { id: "arrow" }] }, { id: "text", containerId: "node" }, { id: "arrow" }];
  const plan = { version: 1, srtPath: "talk.srt", cues: [{ id: 1, startMs: 500, endMs: 1500, text: "node" }, { id: 2, startMs: 2000, endMs: 3000, text: "arrow" }], baseIds: ["existing"], steps: [{ cueId: 1, atMs: 500, elementIds: ["node", "text"] }, { cueId: 2, atMs: 2000, elementIds: ["arrow"] }] };
  elements[0].customData = { exbasePresentation: plan };
  assert.equal(presentationFromElements(elements), plan);
  assert.equal(validatePresentation(plan, elements), plan);
  assert.deepEqual(revealedElements(elements, plan, revealIndex(plan, 499)).map(e => e.id), ["existing"]);
  const shown = revealedElements(elements, plan, revealIndex(plan, 500));
  assert.deepEqual(shown.map(e => e.id), ["existing", "node", "text"]);
  assert.deepEqual(shown[1].boundElements, [{ id: "text" }]);
  assert.equal(elements[1].boundElements.length, 2);
  assert.equal(revealIndex(plan, 2000), 2);
  assert.equal(revealIndex(plan, 2000, 100), 1);
  assert.equal(revealIndex(plan, 0), 0);
  assert.throws(() => validatePresentation(plan, elements.slice(0, 3)), /missing/);
  assert.equal(presentationFromElements([{ ...elements[0], isDeleted: true }]), null);
});

test("linked narration assets survive serialization and changed subtitles block stale playback", () => {
  const plan = { version: 1, srtPath: "talk.srt", videoPath: "media/talk.mp4", cues: [{ id: 1, startMs: 0, endMs: 1000, text: "node" }], baseIds: [], steps: [{ cueId: 1, atMs: 0, elementIds: ["node"] }] };
  const elements = [{ id: "node", version: 1, customData: { keep: true, exbasePresentation: plan } }];
  const next = updatePresentationElements(elements, { srtPath: "new.srt", needsGeneration: true, visualDescription: "Two blue nodes" });
  assert.equal(elements[0].customData.exbasePresentation.srtPath, "talk.srt");
  assert.equal(next[0].customData.keep, true);
  const restored = JSON.parse(JSON.stringify(next));
  assert.equal(presentationFromElements(restored).videoPath, "media/talk.mp4");
  assert.throws(() => validatePresentation(presentationFromElements(restored), restored), /Subtitles changed/);
  const ready = updatePresentationElements(restored, { needsGeneration: false });
  assert.equal(validatePresentation(presentationFromElements(ready), ready).visualDescription, "Two blue nodes");
  assert.equal(updatePresentationElements(ready, { needsGeneration: false })[0], ready[0]);
});

test("face bubbles stay square and within the 16:9 stage while resizing", () => {
  const bubble = clampBubble({ x: 2, y: 2, size: 1, shape: "circle" });
  assert.equal(bubble.size, .45);
  assert.ok(bubble.x + bubble.size <= 1);
  assert.ok(bubble.y + bubble.size * 16 / 9 <= 1);
  assert.equal(clampBubble({ x: -1, y: -1, size: 0 }).size, .08);
});
