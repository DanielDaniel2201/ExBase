import { splitMCPElements } from "./scene.js";

const key = "exbaseMermaid";
const volatile = new Set(["version", "versionNonce", "updated", "index", "seed", "customData", "boundElements"]);
const metadata = (element) => element.customData?.[key];
const bump = (element, changes) => ({ ...element, ...changes, version: (element.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2147483647) });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;
}

export function diagramBounds(elements) {
  return { x: Math.min(...elements.map((e) => e.x)), y: Math.min(...elements.map((e) => e.y)), right: Math.max(...elements.map((e) => e.x + (e.width || 0))) };
}

export function diagramSignature(elements) {
  const { x, y } = diagramBounds(elements);
  return JSON.stringify(canonical([...elements].sort((a, b) => a.id.localeCompare(b.id)).map((element) => {
    const entry = Object.fromEntries(Object.entries(element).filter(([field]) => !volatile.has(field)));
    return { ...entry, x: element.x - x, y: element.y - y };
  })));
}

export function mermaidDiagrams(elements) {
  const groups = new Map();
  for (const element of elements) {
    const data = metadata(element);
    if (!data || typeof data.id !== "string" || element.isDeleted) continue;
    if (!groups.has(data.id)) groups.set(data.id, { id: data.id, elements: [], record: null });
    const group = groups.get(data.id);
    group.elements.push(element);
    if (typeof data.source === "string") group.record = data;
  }
  return [...groups.values()];
}

// A native edit detaches the entire diagram. Uniform translation and external boundElements do not change its source.
export function reconcileMermaid(elements, previous = []) {
  const old = new Map(previous.map((e) => [e.id, metadata(e)]));
  let output = elements.map((e) => !metadata(e) && old.get(e.id) ? { ...e, customData: { ...e.customData, [key]: old.get(e.id) } } : e);
  for (const group of mermaidDiagrams(output)) {
    const record = group.record;
    const ids = group.elements.map((e) => e.id).sort();
    const active = record?.active === true && Array.isArray(record.members) &&
      JSON.stringify(ids) === JSON.stringify([...record.members].sort()) && record.signature === diagramSignature(group.elements);
    if (active) continue;
    output = output.map((e) => {
      const data = metadata(e);
      if (data?.id !== group.id || data.active === false) return e;
      return bump(e, { customData: { ...e.customData, [key]: { ...data, active: false } } });
    });
  }
  return output.every((e, i) => e === elements[i]) ? elements : output;
}

export function markMermaid(elements, id, source, idMap) {
  const record = { id, active: true, source, idMap, members: elements.map((e) => e.id), signature: diagramSignature(elements) };
  return elements.map((e, i) => ({ ...e, customData: { ...e.customData, [key]: i === 0 ? record : { id, active: true } } }));
}

// Namespace groups and preserve logical node IDs across recompiles. Parallel edges need distinct keys too.
export function remapSkeleton(skeleton, id, previousMap = {}) {
  const counts = new Map(), nodeIds = new Map(), idMap = {};
  const elements = skeleton.map((e, index) => {
    const logical = `${e.type}:${e.id ?? index}`;
    const occurrence = counts.get(logical) || 0;
    counts.set(logical, occurrence + 1);
    const mapKey = `${logical}:${occurrence}`;
    const elementId = previousMap[mapKey] || `${id}:${mapKey}`;
    idMap[mapKey] = elementId;
    if (e.type !== "arrow" && e.id) nodeIds.set(e.id, elementId);
    return { ...e, id: elementId, groupIds: (e.groupIds || []).map((g) => `${id}:${g}`), label: e.label ? { ...e.label, groupIds: (e.label.groupIds || []).map((g) => `${id}:${g}`) } : undefined };
  });
  return { elements: elements.map((e) => ({ ...e, ...(e.start ? { start: { ...e.start, id: nodeIds.get(e.start.id) } } : {}), ...(e.end ? { end: { ...e.end, id: nodeIds.get(e.end.id) } } : {}) })), idMap };
}

export function normalizeMermaidBreaks(elements) {
  const normalize = (text) => typeof text === "string" ? text.replace(/<br\s*\/?>/gi, "\n") : text;
  return elements.map((element) => ({ ...element, ...(typeof element.text === "string" && { text: normalize(element.text) }), ...(typeof element.label?.text === "string" && { label: { ...element.label, text: normalize(element.label.text) } }) }));
}

export function replaceDiagram(current, group, replacement) {
  if (!group) return [...current, ...replacement];
  const old = new Map(group.elements.map((e) => [e.id, e]));
  const next = new Map(replacement.map((e) => [e.id, e]));
  // ponytail: scale straight external endpoints with node bounds; native edits handle rotated/elbowed connections.
  const outside = current.filter((e) => !old.has(e.id)).map((e) => {
    if (!e.points || ![e.startBinding?.elementId, e.endBinding?.elementId].some((id) => old.has(id))) return e;
    const points = e.points.map(([x, y]) => [e.x + x, e.y + y]);
    for (const [binding, index] of [[e.startBinding, 0], [e.endBinding, points.length - 1]]) {
      const from = old.get(binding?.elementId);
      if (!from) continue;
      const to = next.get(from.id);
      if (!to) throw new Error("A removed node has an external connection. Preserve that node or edit its connection first.");
      if (from.angle || to.angle || e.elbowed) throw new Error("Use native edits for this diagram's rotated or elbowed external connections.");
      points[index] = [to.x + (points[index][0] - from.x) * (to.width / (from.width || 1)), to.y + (points[index][1] - from.y) * (to.height / (from.height || 1))];
    }
    const [x, y] = points[0];
    return bump(e, { x, y, points: points.map(([px, py]) => [px - x, py - y]), width: Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])), height: Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])) });
  });
  return [...outside, ...replacement];
}

export async function materializeCanvas(elements, previous = []) {
  const { convertToExcalidrawElements, hashString, restore } = await import("@excalidraw/excalidraw");
  const { standard, shorthand } = splitMCPElements(elements);
  const converted = convertToExcalidrawElements(shorthand.map((element) => ({ ...element, seed: element.seed ?? hashString(element.id), ...(element.label && { label: { ...element.label, id: element.label.id ?? `ai-label-${element.id}` } }) })), { regenerateIds: false });
  return reconcileMermaid(restore({ elements: [...standard, ...converted] }, null, null, { repairBindings: true }).elements, previous);
}

export async function renderMermaid(request) {
  const current = await materializeCanvas(request.elements);
  const source = request.source?.trim();
  if (!source || source.length > 16000 || !/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/.test(source) || /%%\s*\{/.test(source)) throw new Error("Use a Mermaid flowchart with a direction, without configuration directives (maximum 16000 characters).");
  const group = request.diagramId ? mermaidDiagrams(current).find((g) => g.id === request.diagramId) : null;
  if (request.diagramId && (!group || group.record?.active !== true)) throw new Error("This diagram is detached or missing. Read the current canvas and use native edits; its old source cannot overwrite it.");
  const id = group?.id || crypto.randomUUID();
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const parsed = await parseMermaidToExcalidraw(source, { securityLevel: "strict", maxEdges: 250, maxTextSize: 16000 });
  if (!parsed.elements.length || parsed.elements.some((e) => e.type === "image") || Object.keys(parsed.files || {}).length) throw new Error("The diagram could not be converted to editable shapes. Simplify the flowchart or use native drawing.");
  const remapped = remapSkeleton(normalizeMermaidBreaks(parsed.elements), id, group?.record.idMap);
  let replacement = await materializeCanvas(remapped.elements);
  const bounds = diagramBounds(replacement);
  const previousBounds = group ? diagramBounds(group.elements) : null;
  const x = request.x ?? previousBounds?.x ?? (current.length ? diagramBounds(current).right + 100 : 0);
  const y = request.y ?? previousBounds?.y ?? 0;
  if (![x, y].every(Number.isFinite)) throw new Error("Invalid diagram position");
  replacement = replacement.map((e) => {
    const old = current.find((original) => original.id === e.id);
    return { ...e, x: e.x + x - bounds.x, y: e.y + y - bounds.y, version: (old?.version || 0) + 1 };
  });
  const updated = await materializeCanvas(replaceDiagram(current, group, replacement));
  const memberIds = new Set(replacement.map((e) => e.id));
  replacement = markMermaid(updated.filter((e) => memberIds.has(e.id)), id, source, remapped.idMap);
  const members = new Map(replacement.map((e) => [e.id, e]));
  return updated.map((e) => members.get(e.id) || e);
}
