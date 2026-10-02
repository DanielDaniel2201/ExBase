import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { pptElementKind, slidesPPT } from "./slide-export.js";

test("PPT keeps text and shapes native, image fallbacks independent, order and page proportions", async () => {
  const dataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const frame = { x: 1000, y: 2000 };
  const shape = { id: "box", type: "rectangle", x: 1010, y: 2020, width: 200, height: 100, strokeColor: "#123456", backgroundColor: "transparent", opacity: 70, strokeWidth: 2, roundness: { type: 3 } };
  const text = { ...shape, id: "label", type: "text", text: "Editable & <text>\nSecond line", containerId: "box", fontFamily: 2, fontSize: 24, textAlign: "center", lineHeight: 1.25 };
  const arrow = { ...shape, id: "arrow", type: "arrow", points: [[0, 0], [-100, 50]], width: 100, height: 50, endArrowhead: "arrow", strokeStyle: "dashed" };
  const image = { ...shape, id: "drawing", type: "image", dataURL };
  const encoded = await slidesPPT([
    { name: "Second page", frame, width: 1600, height: 900, background: "#f3f3f5", elements: [shape, text, arrow, image] },
    { name: "First", frame, width: 900, height: 1600, elements: [{ ...text, text: "Tall page" }] },
  ], "Frames");
  const zip = await JSZip.loadAsync(Buffer.from(encoded, "base64"));
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert.equal((presentation.match(/<p:sldId /g) || []).length, 2);
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.equal((xml.match(/<p:pic>/g) || []).length, 1);
  assert.equal((xml.match(/<p:sp>/g) || []).length, 3);
  assert.ok(xml.includes("Editable &amp; &lt;text&gt;"));
  assert.ok(xml.includes("Second line"));
  assert.ok(xml.includes('prst="roundRect"'));
  assert.ok(xml.includes('prst="line"'));
  assert.ok(xml.includes('type="arrow"'));
  assert.ok(xml.includes('flipH="1"'));
  assert.ok(xml.includes('val="123456"'));
  assert.ok(xml.includes('val="F3F3F5"'));
  assert.ok(xml.includes('typeface="Arial"'));
  assert.ok(xml.includes('val="70000"'));
  assert.ok((await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string")).includes("/image"));
  assert.ok((await zip.file("ppt/notesSlides/notesSlide1.xml").async("string")).includes("Second page"));
  const tall = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.ok(tall.includes("Tall page"));
  assert.ok(!tall.includes("<p:pic>"));
  const ext = tall.match(/<p:sp>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/);
  assert.ok(Math.abs(Number(ext[1]) / Number(ext[2]) - 2) < 0.001);
});

test("only supported basic elements are native; complex paths and arrowheads use images", () => {
  assert.equal(pptElementKind({ type: "text" }), "text");
  for (const type of ["rectangle", "ellipse", "diamond"]) assert.equal(pptElementKind({ type }), type);
  const arrow = { type: "arrow", points: [[0, 0], [100, 0]], endArrowhead: "triangle" };
  assert.equal(pptElementKind(arrow), "line");
  assert.equal(pptElementKind({ ...arrow, endArrowhead: "bar" }), "image");
  assert.equal(pptElementKind({ ...arrow, points: [[0, 0], [50, 20], [100, 0]] }), "image");
  assert.equal(pptElementKind({ type: "freedraw" }), "image");
});
