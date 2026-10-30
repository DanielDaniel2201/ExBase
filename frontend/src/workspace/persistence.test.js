import assert from "node:assert/strict";
import test from "node:test";
import { documentPersistence } from "./persistence.js";

test("reopen, switch and close of an unchanged document never write stale content", async () => {
  let writes = 0;
  const state = documentPersistence("old-disk-version", "normalized scene", async () => { writes++; });
  for (let i = 0; i < 3; i++) await state.save("normalized scene");
  assert.equal(writes, 0);
});

test("queued saves use the last successful disk version, including undo while saving", async () => {
  const writes = [];
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const state = documentPersistence("v1", "old", async (data, version) => {
    writes.push([data, version]);
    if (data === "edited") await gate;
    return `v${writes.length + 1}`;
  });
  const first = state.save("edited");
  const undo = state.save("old");
  assert.equal(state.pending, 2);
  finish();
  await Promise.all([first, undo]);
  assert.deepEqual(writes, [["edited", "v1"], ["old", "v2"]]);
  assert.equal(state.saved, "old");
  assert.equal(state.pending, 0);
});

test("conflicts preserve the baseline and cannot silently authorize a later overwrite", async () => {
  const versions = [];
  const state = documentPersistence("v1", "old", async (data, version) => {
    versions.push(version);
    throw new Error("EXBASE_FILE_CHANGED");
  });
  await assert.rejects(state.save("edited"), /EXBASE_FILE_CHANGED/);
  await assert.rejects(state.save("edited again"), /EXBASE_FILE_CHANGED/);
  assert.equal(state.saved, "old");
  assert.deepEqual(versions, ["v1", "v1"]);
  assert.equal(state.pending, 0);
  let written;
  const reloaded = documentPersistence("v2", "external", async (data, version) => { written = [data, version]; return "v3"; });
  await reloaded.save("new edits");
  assert.deepEqual(written, ["new edits", "v2"]);
});
