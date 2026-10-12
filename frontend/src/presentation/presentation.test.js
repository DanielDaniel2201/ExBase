import assert from "node:assert/strict";
import test from "node:test";
import { clampBubble, presentationFromElements, updatePresentationElements, validatePresentation } from "./presentation.js";

const elements = [{ id: "a", type: "rectangle" }, { id: "b", type: "rectangle" }];
const plan = {
  version: 2, srtPath: "talk.srt", videoPath: "media/talk.mp4",
  cues: [1, 2, 3, 4].map((id) => ({ id, startMs: (id - 1) * 1000, endMs: id * 1000, text: "topic" })),
  camera: [{ cueId: 1, atMs: 0, elementIds: ["b"] }, { cueId: 2, atMs: 1000, elementIds: ["a"] }, { cueId: 3, atMs: 2000, elementIds: ["b"] }, { cueId: 4, atMs: 3000, elementIds: [] }],
};

test("camera-only timelines focus anywhere, revisit regions and ignore legacy reveals", () => {
  assert.equal(validatePresentation(plan, elements), plan);
  const legacy = { ...plan, version: 1, baseIds: [], steps: [{ cueId: 4, atMs: 3000, elementIds: ["b"] }] };
  assert.equal(validatePresentation(legacy, elements), legacy);
  assert.equal(validatePresentation(plan, [...elements, { id: "new", type: "text" }]), plan);
  assert.throws(() => validatePresentation({ ...plan, camera: undefined }, elements), /Generate Pan/);
  assert.throws(() => validatePresentation(plan, [elements[0]]), /missing/);
  assert.throws(() => validatePresentation({ ...plan, camera: [plan.camera[0], plan.camera[0]] }, elements), /Invalid camera/);
  assert.throws(() => validatePresentation({ ...plan, camera: [{ cueId: 2, atMs: -1, elementIds: [] }] }, elements), /Invalid camera/);
  assert.throws(() => validatePresentation({ ...plan, camera: [{ cueId: 1, atMs: 0, elementIds: ["a", "a"] }] }, elements), /Invalid camera/);
  assert.throws(() => validatePresentation(plan, [{ ...elements[1], isDeleted: true }, elements[0]]), /missing/);
});

test("linked assets and options survive serialization, changed subtitles block stale playback", () => {
  const scene = [{ ...elements[0], version: 1, customData: { keep: true, exbasePresentation: plan } }, elements[1]];
  assert.equal(presentationFromElements(scene), plan);
  const next = updatePresentationElements(scene, { srtPath: "new.srt", needsGeneration: true, narrationRequirements: "Focus on whole topics" });
  assert.equal(scene[0].customData.exbasePresentation.srtPath, "talk.srt");
  assert.equal(next[0].customData.keep, true);
  const restored = JSON.parse(JSON.stringify(next));
  assert.equal(presentationFromElements(restored).videoPath, "media/talk.mp4");
  assert.throws(() => validatePresentation(presentationFromElements(restored), restored), /Subtitles changed/);
  const ready = updatePresentationElements(restored, { needsGeneration: false });
  assert.equal(validatePresentation(presentationFromElements(ready), ready).narrationRequirements, "Focus on whole topics");
  assert.equal(updatePresentationElements(ready, { needsGeneration: false })[0], ready[0]);
  assert.equal(presentationFromElements([{ ...scene[0], isDeleted: true }]), null);
});

test("face bubbles stay square and within the stage while resizing", () => {
  const bubble = clampBubble({ x: 2, y: 2, size: 1, shape: "circle" });
  assert.equal(bubble.size, .45);
  assert.ok(bubble.x + bubble.size <= 1);
  assert.ok(bubble.y + bubble.size * 16 / 9 <= 1);
  assert.equal(clampBubble({ x: -1, y: -1, size: 0 }).size, .08);
});
