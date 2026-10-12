import assert from "node:assert/strict";
import test from "node:test";
import { cameraTrack, fitCamera } from "./camera.js";

test("camera fits wide, tall and tiny regions without clipping or excessive zoom", () => {
  for (const bounds of [[0, 0, 2000, 100], [-100, -500, 100, 1000], [0, 0, 1, 1]]) {
    const view = fitCamera(bounds);
    assert.ok(view.width >= 480);
    assert.ok(view.x - view.width / 2 <= bounds[0]);
    assert.ok(view.x + view.width / 2 >= bounds[2]);
    assert.ok(view.y - view.width * 9 / 32 <= bounds[1]);
    assert.ok(view.y + view.width * 9 / 32 >= bounds[3]);
  }
});

test("camera supports A to B to A, overviews, holds and deterministic backward seeks", () => {
  const overview = { x: 500, y: 100, width: 1500 };
  const a = { x: 0, y: 100, width: 480 }, b = { x: 700, y: 100, width: 480 };
  const camera = cameraTrack(overview, [{ atMs: 500, viewport: a }, { atMs: 2000, viewport: b }, { atMs: 4000, viewport: a }, { atMs: 6000, viewport: overview }]);
  assert.deepEqual(camera(0), overview);
  assert.deepEqual(camera(1500), a);
  assert.deepEqual(camera(3500), b);
  assert.deepEqual(camera(5500), a);
  assert.deepEqual(camera(8000), overview);
  const halfway = camera(900);
  assert.ok(halfway.x > a.x && halfway.x < overview.x);
  assert.ok(halfway.width > a.width && halfway.width < overview.width);
  assert.deepEqual(camera(900), halfway);
  assert.deepEqual(camera(1500), a);
});

test("distant moves zoom out in transit, adjacent moves pan, short cues finish before the next shot", () => {
  const a = { x: 0, y: 0, width: 480 }, b = { x: 2000, y: 0, width: 480 };
  const far = cameraTrack(a, [{ atMs: 100, viewport: b }]);
  assert.ok(far(800).width > a.width);
  assert.equal(far(800).x, 1000);
  assert.deepEqual(far(1500), b);
  const nearby = { ...a, x: 200 };
  const near = cameraTrack(a, [{ atMs: 100, viewport: nearby }, { atMs: 300, viewport: a }]);
  assert.equal(near(200).width, 480);
  assert.deepEqual(near(300), nearby);
  assert.deepEqual(near(1200), a);
  const repeated = cameraTrack(a, [{ atMs: 0, viewport: a }, { atMs: 1000, viewport: a }]);
  assert.deepEqual(repeated(1500), a);
});
