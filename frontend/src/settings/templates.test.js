import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingTemplates, firstBlank } from "./templates.js";

test("slash search and insertion preserve literal templates and identify the first blank", () => {
  const templates = [{ name: "PPT 演示", body: "主题：{{主题}}\n要点：{{要点}}" }, { name: "Demo", body: "Draw [topic]" }];
  assert.deepEqual(matchingTemplates(templates, "/"), templates);
  assert.deepEqual(matchingTemplates(templates, "/ppt"), [templates[0]]);
  assert.deepEqual(matchingTemplates(templates, "/演示"), [templates[0]]);
  assert.deepEqual(matchingTemplates(templates, "https://demo"), []);
  assert.deepEqual(matchingTemplates(templates, "/PPT\ntext"), []);
  assert.deepEqual(firstBlank(templates[0].body), [3, 9]);
  assert.deepEqual(firstBlank(templates[1].body), [12, 12]);
});
