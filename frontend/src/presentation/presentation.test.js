import assert from "node:assert/strict";
import test from "node:test";
import { clampBubble, presentationFromElements, revealIndex, revealedElements, validatePresentation } from "./presentation.js";
import { srtTemplate, templatesForChat } from "../settings/templates.js";

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

test("face bubbles stay square and within the 16:9 stage while resizing", () => {
  const bubble = clampBubble({ x: 2, y: 2, size: 1, shape: "circle" });
  assert.equal(bubble.size, .45);
  assert.ok(bubble.x + bubble.size <= 1);
  assert.ok(bubble.y + bubble.size * 16 / 9 <= 1);
  assert.equal(clampBubble({ x: -1, y: -1, size: 0 }).size, .08);
});

test("SRT template stays available with existing custom templates and supports an override", () => {
  const custom = [{ name: "Custom", body: "custom" }];
  assert.equal(templatesForChat(custom).at(-1), srtTemplate);
  assert.equal(custom.length, 1);
  const override = [{ ...srtTemplate, body: "my version" }];
  assert.equal(templatesForChat(override), override);
});
