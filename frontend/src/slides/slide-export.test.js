import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { slidesPPT } from "./slide-export.js";

test("PPT export packages every slide and preserves order, notes and image relationships", async () => {
  const dataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const encoded = await slidesPPT([{ name: "第二页", width: 1, height: 1, dataURL }, { name: "First", width: 1, height: 1, dataURL }], "Frames");
  const zip = await JSZip.loadAsync(Buffer.from(encoded, "base64"));
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert.equal((presentation.match(/<p:sldId /g) || []).length, 2);
  assert.ok((await zip.file("ppt/slides/slide1.xml").async("string")).includes("<p:pic>"));
  assert.ok((await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string")).includes("/image"));
  assert.ok((await zip.file("ppt/notesSlides/notesSlide1.xml").async("string")).includes("第二页"));
  assert.ok((await zip.file("ppt/notesSlides/notesSlide2.xml").async("string")).includes("First"));
});
