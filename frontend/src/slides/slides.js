export function slideFrames(elements) {
  const live = elements.filter((element) => !element.isDeleted);
  const frames = live.filter((element) => element.type === "frame" && Number.isFinite(element.width) && Number.isFinite(element.height) && element.width > 0 && element.height > 0);
  if (!frames.length) return [];
  const ids = new Set(frames.map((frame) => frame.id));
  const byId = new Map(live.map((element) => [element.id, element]));
  if (live.some((element) => !ids.has(element.id) && !ids.has(element.frameId) && !(element.type === "text" && ids.has(byId.get(element.containerId)?.frameId)))) return [];
  return frames.sort((a, b) => (a.customData?.exbaseSlideOrder ?? Infinity) - (b.customData?.exbaseSlideOrder ?? Infinity) || a.y - b.y || a.x - b.x);
}

export function frameElements(elements, frame) {
  const members = new Set(elements.filter((element) => element.frameId === frame.id).map((element) => element.id));
  return elements.filter((element) => !element.isDeleted && (element.id === frame.id || members.has(element.id) || (element.type === "text" && members.has(element.containerId))));
}

export function orderedFrameElements(elements, frameIds) {
  const order = new Map(frameIds.map((id, index) => [id, index]));
  return elements.map((element) => order.has(element.id) ? { ...element, customData: { ...element.customData, exbaseSlideOrder: order.get(element.id) }, version: (element.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() } : element);
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function slidesHTML(slides, title) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title>
<style>*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;font:14px system-ui;background:#f3f3f5;color:#202124}main{height:100%;display:flex;align-items:center;justify-content:center;padding:24px 24px 72px}figure{display:none;position:relative;margin:0;width:100%;height:100%}figure.active{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 2px 16px #0002}nav{position:fixed;bottom:16px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:16px}button{font:inherit;color:inherit;background:#fff;border:1px solid #ccc;border-radius:6px;padding:8px 14px;cursor:pointer}button:disabled{opacity:.4}@media print{html,body,main{height:auto;overflow:visible;background:white}main{display:block;padding:0}figure,figure.active{display:flex;height:100vh;break-after:page;align-items:center;justify-content:center}nav{display:none}}</style></head><body><main>
${slides.map((slide, index) => `<figure${index === 0 ? ' class="active"' : ""}><img src="${escapeHTML(slide.dataURL)}" alt="${escapeHTML(slide.name)}"></figure>`).join("\n")}
</main><nav><button id="prev" aria-label="Previous slide">←</button><span id="count" aria-live="polite"></span><button id="next" aria-label="Next slide">→</button></nav>
<script>const slides=[...document.querySelectorAll('figure')];let current=0;function show(index){current=Math.max(0,Math.min(slides.length-1,index));slides.forEach((slide,i)=>slide.classList.toggle('active',i===current));document.getElementById('count').textContent=(current+1)+' / '+slides.length;document.getElementById('prev').disabled=current===0;document.getElementById('next').disabled=current===slides.length-1;}document.getElementById('prev').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);document.addEventListener('keydown',event=>{if(['ArrowRight','ArrowDown','PageDown',' '].includes(event.key)){event.preventDefault();show(current+1);}else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key)){event.preventDefault();show(current-1);}else if(event.key==='Home')show(0);else if(event.key==='End')show(slides.length-1);});show(0);</script></body></html>`;
}
