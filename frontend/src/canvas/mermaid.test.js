import assert from "node:assert/strict";
import test from "node:test";
import { markMermaid, mermaidDiagrams, normalizeMermaidBreaks, reconcileMermaid, remapSkeleton, replaceDiagram } from "./mermaid.js";

const node = (id, x = 0) => ({ id, type: "rectangle", x, y: 0, width: 100, height: 60, angle: 0, isDeleted: false, version: 1, versionNonce: 1, groupIds: ["native-group"] });
const diagram = () => markMermaid([node("a"), node("b", 200)], "diagram", "flowchart LR\nA-->B", { "rectangle:A:0": "a" });

test("managed diagrams survive persistence, uniform movement and unrelated native edits", () => {
  const original = diagram();
  const saved = JSON.parse(JSON.stringify(original));
  assert.strictEqual(reconcileMermaid(saved), saved);
  const moved = saved.map((e) => ({ ...e, x: e.x + 30, y: e.y - 20, version: 2, versionNonce: 42, updated: 123, index: "new", boundElements: [{ id: "outside", type: "arrow" }] }));
  assert.strictEqual(reconcileMermaid(moved), moved);
  const mixed = [...moved, node("circuit", 500)];
  assert.strictEqual(reconcileMermaid(mixed), mixed);
  assert.equal(mermaidDiagrams(mixed)[0].record.source, "flowchart LR\nA-->B");
});

test("internal changes, missing members and copying detach the whole diagram and preserve native groups", () => {
  for (const changed of [
    diagram().map((e, i) => i ? { ...e, x: 220 } : e),
    diagram().map((e, i) => i ? { ...e, strokeColor: "red" } : e),
    diagram().slice(0, 1),
    diagram().slice(1),
    diagram().map((e, i) => i ? { ...e, isDeleted: true } : e),
    [...diagram(), ...diagram().map((e) => ({ ...e, id: e.id + "copy" }))],
  ]) {
    const result = reconcileMermaid(changed);
    const group = mermaidDiagrams(result)[0];
    assert.ok(group.elements.every((e) => e.customData.exbaseMermaid.active === false));
    assert.deepEqual(result[0].groupIds, ["native-group"]);
    assert.equal(result[0].id, changed[0].id);
    assert.strictEqual(reconcileMermaid(result), result, "detachment must settle without an onChange loop");
    assert.strictEqual(reconcileMermaid(JSON.parse(JSON.stringify(result))).length, result.length);
  }
});

test("native AI replacements cannot erase provenance and silently reactivate stale source", () => {
  const previous = diagram();
  const changed = previous.map((e) => { const { customData, ...native } = e; return { ...native, width: 150 }; });
  const result = reconcileMermaid(changed, previous);
  assert.ok(result.every((e) => !e.customData.exbaseMermaid.active));
  assert.equal(mermaidDiagrams(result)[0].record.source, "flowchart LR\nA-->B");
});

test("diagram IDs, parallel edges and subgroups are isolated while node IDs survive recompilation", () => {
  const skeleton = [
    { ...node("A"), label: { text: "A", groupIds: ["subgraph"] } }, node("B", 200),
    { id: "A_B", type: "arrow", start: { id: "A" }, end: { id: "B" } },
    { id: "A_B", type: "arrow", start: { id: "A" }, end: { id: "B" } },
  ];
  const first = remapSkeleton(skeleton, "one");
  const second = remapSkeleton(skeleton, "two");
  assert.equal(new Set([...first.elements, ...second.elements].map((e) => e.id)).size, 8);
  assert.equal(first.elements[2].start.id, first.elements[0].id);
  assert.notEqual(first.elements[2].id, first.elements[3].id);
  assert.notEqual(first.elements[0].groupIds[0], second.elements[0].groupIds[0]);
  assert.deepEqual(remapSkeleton(skeleton, "one", first.idMap), first);
  assert.equal(skeleton[0].id, "A");
});

test("Mermaid HTML breaks become editable line breaks", () => {
  const [node, text] = normalizeMermaidBreaks([
    { type: "rectangle", label: { text: "Q<br/>查询<br >详情" } },
    { type: "text", text: "输入<BR>嵌入" },
  ]);
  assert.equal(node.label.text, "Q\n查询\n详情");
  assert.equal(text.text, "输入\n嵌入");
});

test("replacement preserves unrelated drawings and moves externally bound endpoints; removed targets are rejected", () => {
  const managed = diagram();
  const group = mermaidDiagrams(managed)[0];
  const circuit = node("circuit", 500);
  const external = { id: "wire", type: "arrow", x: 100, y: 30, version: 1, points: [[0, 0], [400, 0]], startBinding: { elementId: "a" } };
  const current = [...managed, circuit, external];
  const replacement = [node("a", 50), node("b", 250)];
  const result = replaceDiagram(current, group, replacement);
  assert.strictEqual(result.find((e) => e.id === "circuit"), circuit);
  const wire = result.find((e) => e.id === "wire");
  assert.equal(wire.startBinding.elementId, "a");
  assert.deepEqual([wire.x, wire.y], [150, 30]);
  assert.deepEqual([wire.x + wire.points[1][0], wire.y + wire.points[1][1]], [500, 30]);
  assert.throws(() => replaceDiagram(current, group, [node("b")]), /external connection/);
  assert.deepEqual(current[3].points, [[0, 0], [400, 0]], "failed replacement must not mutate the canvas");
});
