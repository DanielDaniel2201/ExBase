import assert from "node:assert/strict";
import { test } from "node:test";
import { slideFrames, frameElements, orderedFrameElements, slidesHTML } from "./slides.js";

test("slides require live frames and every live content element to belong to a valid frame", () => {
  const first = { id: "f1", type: "frame", x: 0, y: 0, width: 1600, height: 900, version: 1, customData: { keep: true } };
  const second = { ...first, id: "f2", x: 1800 };
  const shape = { id: "shape", type: "rectangle", frameId: "f1" };
  const text = { id: "label", type: "text", containerId: "shape" };
  const elements = [second, first, shape, text, { id: "removed", type: "rectangle", isDeleted: true }];
  assert.deepEqual(slideFrames([]), []);
  assert.deepEqual(slideFrames([shape]), []);
  assert.deepEqual(slideFrames(elements).map(f => f.id), ["f1", "f2"]);
  assert.deepEqual(slideFrames([...elements, { id: "outside", type: "rectangle" }]), []);
  assert.deepEqual(slideFrames([...elements, { id: "orphan", type: "rectangle", frameId: "missing" }]), []);
  assert.deepEqual(slideFrames([{ ...first, isDeleted: true }, shape]), []);
  assert.deepEqual(slideFrames([{ ...first, width: 0 }]), []);
  assert.deepEqual(frameElements(elements, first).map(e => e.id), ["f1", "shape", "label"]);
  const ordered = orderedFrameElements(elements, ["f2", "f1"]);
  assert.deepEqual(slideFrames(ordered).map(f => f.id), ["f2", "f1"]);
  assert.equal(ordered[1].customData.keep, true);
  assert.equal(ordered[1].version, 2);
  assert.equal(ordered[2], shape);
  assert.equal(first.customData.exbaseSlideOrder, undefined);
  assert.deepEqual(slideFrames(JSON.parse(JSON.stringify(ordered))).map(f => f.id), ["f2", "f1"]);
});

test("offline slide HTML escapes names and embeds selectable SVG text in slide order", () => {
  const html = slidesHTML([{ name: '<img onerror="alert(1)">', svg: '<svg><text>First selectable text</text></svg>' }, { name: "Second", svg: '<svg><text>Second selectable text</text></svg>' }], "</title><script>alert(1)</script>");
  assert.ok(html.includes("&lt;/title&gt;"));
  assert.ok(!html.includes('<img onerror="alert(1)">'));
  assert.equal((html.match(/<figure/g) || []).length, 2);
  assert.ok(html.indexOf("First selectable text") < html.indexOf("Second selectable text"));
  assert.ok(!html.includes('src="http'));
  assert.equal((html.match(/<svg>/g) || []).length, 2);
  assert.ok(html.includes("user-select:text"));
  assert.ok(!html.includes("<img src="));
});
