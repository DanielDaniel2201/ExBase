import { frameElements, slidesHTML } from "./slides.js";

const fontFaces = { 1: "Virgil", 2: "Arial", 3: "Cascadia Code", 5: "Excalifont", 6: "Nunito", 7: "Lilita One", 8: "Comic Shanns", 9: "Liberation Sans" };
const arrowHeads = { arrow: "arrow", triangle: "triangle", "triangle_outline": "triangle", dot: "oval", "circle": "oval", "circle_outline": "oval", diamond: "diamond", "diamond_outline": "diamond" };

export function pptElementKind(element) {
  if (["text", "rectangle", "ellipse", "diamond"].includes(element.type)) return element.type;
  if (["line", "arrow"].includes(element.type) && element.points?.length === 2 &&
      (!element.startArrowhead || arrowHeads[element.startArrowhead]) && (!element.endArrowhead || arrowHeads[element.endArrowhead])) return "line";
  return "image";
}

export async function prepareSlideExport(frames, snapshot, format) {
  const { exportToCanvas, exportToSvg, getCommonBounds } = await import("@excalidraw/excalidraw");
  const slides = [];
  for (const [index, frame] of frames.entries()) {
    const elements = frameElements(snapshot.elements, frame);
    const slide = { name: frame.name || `Slide ${index + 1}`, width: frame.width, height: frame.height, frame, background: snapshot.appState.viewBackgroundColor, elements: [] };
    const appState = { ...snapshot.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false };
    if (format === "html") {
      const svg = await exportToSvg({ elements, files: snapshot.files, appState, exportingFrame: frame, exportPadding: 0 });
      // Exported links can contain user-provided URLs. Keep this offline viewer inert.
      svg.querySelectorAll("script, foreignObject, a").forEach((node) => {
        if (node.tagName.toLowerCase() === "a") node.replaceWith(...node.childNodes);
        else node.remove();
      });
      for (const node of [svg, ...svg.querySelectorAll("*")]) {
        for (const attribute of [...node.attributes]) {
          if (/^on/i.test(attribute.name) || (["href", "xlink:href"].includes(attribute.name) && !/^(#|data:image\/)/i.test(attribute.value))) node.removeAttribute(attribute.name);
        }
      }
      slide.svg = svg.outerHTML;
    } else {
      for (const element of elements) {
        if (element.type === "frame") continue;
        const detached = { ...element, frameId: null, containerId: null, boundElements: null };
        const bounds = getCommonBounds([detached]);
        const inside = bounds[0] >= frame.x && bounds[1] >= frame.y && bounds[2] <= frame.x + frame.width && bounds[3] <= frame.y + frame.height;
        if (pptElementKind(element) !== "image" && inside) {
          slide.elements.push(element);
          continue;
        }
        const padding = Math.max(2, (element.strokeWidth || 1) * 2);
        const x = Math.max(frame.x, bounds[0] - padding), y = Math.max(frame.y, bounds[1] - padding);
        const width = Math.min(frame.x + frame.width, bounds[2] + padding) - x;
        const height = Math.min(frame.y + frame.height, bounds[3] + padding) - y;
        if (width <= 0 || height <= 0) continue;
        // Render in the frame to preserve rotation and clipping, then crop the independent image.
        const canvas = await exportToCanvas({ elements: [detached], files: snapshot.files, appState: { ...appState, exportBackground: false }, exportingFrame: frame, exportPadding: 0,
          getDimensions: (w, h) => {
            const scale = Math.min(2, 1920 / Math.max(w, h));
            return { width: w * scale, height: h * scale, scale };
          } });
        const cropped = document.createElement("canvas");
        const scaleX = canvas.width / frame.width, scaleY = canvas.height / frame.height;
        cropped.width = Math.max(1, Math.ceil(width * scaleX)); cropped.height = Math.max(1, Math.ceil(height * scaleY));
        cropped.getContext("2d").drawImage(canvas, (x - frame.x) * scaleX, (y - frame.y) * scaleY, width * scaleX, height * scaleY, 0, 0, cropped.width, cropped.height);
        slide.elements.push({ type: "image", id: element.id, x, y, width, height, dataURL: cropped.toDataURL("image/png") });
      }
    }
    slides.push(slide);
  }
  return slides;
}

export function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read slide image"));
    reader.readAsDataURL(blob);
  });
}

export async function slidesPPT(slides, title) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const ppt = new PptxGenJS();
  ppt.title = title; ppt.author = "ExBase";
  const ratio = slides[0].width / slides[0].height;
  const width = 13.333333 * Math.min(1, ratio), height = width / ratio;
  ppt.defineLayout({ name: "FRAMES", width, height });
  ppt.layout = "FRAMES";
  for (const slide of slides) {
    const page = ppt.addSlide();
    page.background = { color: (slide.background || "#ffffff").replace("#", "") };
    const scale = Math.min(width / slide.width, height / slide.height);
    const offsetX = (width - slide.width * scale) / 2, offsetY = (height - slide.height * scale) / 2;
    for (const element of slide.elements) {
      const kind = pptElementKind(element);
      const transparency = 100 - (element.opacity ?? 100);
      const options = { x: offsetX + (element.x - slide.frame.x) * scale, y: offsetY + (element.y - slide.frame.y) * scale,
        w: Math.max(0.001, element.width * scale), h: Math.max(0.001, element.height * scale), rotate: (element.angle || 0) * 180 / Math.PI, objectName: element.id };
      if (kind === "image") {
        page.addImage({ data: element.dataURL, ...options });
      } else if (kind === "text") {
        page.addText(element.text, { ...options, fontFace: fontFaces[element.fontFamily] || "Arial", fontSize: element.fontSize * scale * 72,
          color: (element.strokeColor || "#000000").replace("#", ""), transparency, align: element.textAlign || "left", valign: "top", margin: 0,
          wrap: false, lineSpacingMultiple: element.lineHeight || 1.25, paraSpaceAfter: 0 });
      } else {
        const line = { color: (element.strokeColor === "transparent" ? "#000000" : element.strokeColor || "#000000").replace("#", ""), width: (element.strokeWidth || 1) * scale * 72,
          transparency: element.strokeColor === "transparent" ? 100 : transparency, dashType: { dashed: "dash", dotted: "sysDot" }[element.strokeStyle] || "solid" };
        const fill = { color: (element.backgroundColor === "transparent" ? "#ffffff" : element.backgroundColor || "#ffffff").replace("#", ""),
          transparency: !element.backgroundColor || element.backgroundColor === "transparent" ? 100 : transparency };
        if (kind === "line") {
          const [start, end] = element.points;
          // Use a positive bounding box plus flips so all four line directions survive export.
          options.x += Math.min(start[0], end[0]) * scale; options.y += Math.min(start[1], end[1]) * scale;
          options.w = Math.abs(end[0] - start[0]) * scale; options.h = Math.abs(end[1] - start[1]) * scale;
          options.flipH = end[0] < start[0]; options.flipV = end[1] < start[1];
          line.beginArrowType = arrowHeads[element.startArrowhead] || "none"; line.endArrowType = arrowHeads[element.endArrowhead] || "none";
        }
        // ponytail: native shapes approximate rough strokes and patterned fills; use raster export when exact appearance is required.
        page.addShape({ rectangle: element.roundness ? ppt.ShapeType.roundRect : ppt.ShapeType.rect, ellipse: ppt.ShapeType.ellipse, diamond: ppt.ShapeType.diamond, line: ppt.ShapeType.line }[kind], { ...options, line, fill });
      }
    }
    page.addNotes(slide.name);
  }
  return ppt.write({ outputType: "base64", compression: true });
}

export async function slidesHTMLBase64(slides, title) {
  const url = await blobBase64(new Blob([slidesHTML(slides, title)], { type: "text/html;charset=utf-8" }));
  return url.slice(url.indexOf(",") + 1);
}
