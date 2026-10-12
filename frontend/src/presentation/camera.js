// All camera states are functions of media time, including backward seeks.
export function fitCamera([left, top, right, bottom]) {
  const padding = Math.max(40, Math.max(right - left, bottom - top) * 0.08);
  const width = Math.max(480, right - left + padding * 2, (bottom - top + padding * 2) * 16 / 9);
  return { x: (left + right) / 2, y: (top + bottom) / 2, width };
}

function mixCamera(from, to, progress) {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return from;
  if (p === 1) return to;
  const eased = p * p * (3 - 2 * p);
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, width: from.width === to.width ? from.width : Math.exp(Math.log(from.width) + (Math.log(to.width) - Math.log(from.width)) * eased) };
}

export function cameraTrack(initial, targets) {
  let from = initial;
  const shots = [];
  for (let i = 0; i < targets.length; i++) {
    const { atMs, viewport: to } = targets[i];
    if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1 && Math.abs(from.width - to.width) < 1) continue;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const far = distance > Math.max(from.width, to.width);
    const durationMs = Math.max(1, Math.min(far ? 1400 : 800, targets[i + 1] ? targets[i + 1].atMs - atMs : 1400));
    const middle = far ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, width: Math.max(from.width, to.width, Math.abs(to.x - from.x) + Math.max(from.width, to.width), (Math.abs(to.y - from.y) + Math.max(from.width, to.width) * 9 / 16) * 16 / 9) } : null;
    shots.push({ atMs, durationMs, from, to, middle });
    from = to;
  }
  return (timeMs) => {
    let current = initial;
    for (const shot of shots) {
      if (timeMs < shot.atMs) break;
      const progress = (timeMs - shot.atMs) / shot.durationMs;
      if (progress >= 1) { current = shot.to; continue; }
      if (!shot.middle) return mixCamera(shot.from, shot.to, progress);
      return progress < 0.5 ? mixCamera(shot.from, shot.middle, progress * 2) : mixCamera(shot.middle, shot.to, (progress - 0.5) * 2);
    }
    return current;
  };
}
